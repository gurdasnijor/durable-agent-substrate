import type { FiregridHost } from "@firegrid/host-sdk"
import { durableStreamUrl } from "@firegrid/protocol/launch"
import { Duration, Effect, Layer } from "effect"
import type { TinyFiregridHostEnv } from "../../types.ts"
import {
  awaitFinalResult,
  ClockWorkflow,
  type ExecObservation,
  type GenerationUrls,
  isSuspended,
  observeWake,
  pendingClockWakeups,
  runClockGeneration,
  runWakeGeneration,
  WakeWorkflow,
} from "./workflow.ts"

// This sim drives the real DurableStreamsWorkflowEngine, which lives behind the
// host boundary (drivers may only touch @firegrid/client-sdk). So the host owns
// all engine orchestration and exposes the three probes to the driver as
// ready-to-run, fully-provided Effects via a module latch — same pattern as
// tiny-input-append-wakeup / loop-state-table. The driver stays a thin client
// that triggers probes and asserts on the returned plain data.
//
// tf-12q9: the engine now has a restart recovery sweep for non-clock
// suspensions (recoverSuspendedExecutions, gated on workflow registration). So
// Probes A and B no longer need an explicit re-drive after reconstruction —
// reconstruction ALONE re-arms the parked table-wait body, exactly as Probe C
// (clock) already did. The probes now PASSIVELY wait (bounded) for the
// auto-recovery to complete and assert it ran, mirroring Probe C's
// awaitFinalResult contract. Calling execute/resume in the reconstruction
// generation would mask whether the sweep did the work, so the probes never do.

export interface ProbeResult {
  readonly probe: string
  // Snapshot just before the simulated crash (body parked, input durable).
  readonly beforeCrash: ExecObservation
  // Snapshot after engine reconstruction, with NO external re-drive — the
  // load-bearing measurement: did the recovery sweep process the durable input?
  readonly afterRecovery: ExecObservation
  // Whether the bounded passive wait observed the body complete (finalResult).
  readonly autoRecovered: boolean
  readonly recoveredValue: string | undefined
}

export interface ClockProbeResult {
  readonly suspendedBeforeCrash: boolean
  readonly pendingClockWakeupBeforeCrash: number
  readonly autoCompletedAfterRestart: boolean
}

export interface S1Runtime {
  readonly runProbeA: Effect.Effect<ProbeResult, unknown>
  readonly runProbeB: Effect.Effect<ProbeResult, unknown>
  readonly runProbeC: Effect.Effect<ClockProbeResult, unknown>
}

const runtimeLatch = (() => {
  let resolveRuntime: (runtime: S1Runtime) => void = () => undefined
  const promise = new Promise<S1Runtime>(resolve => {
    resolveRuntime = resolve
  })
  return { promise, resolve: resolveRuntime }
})()

export const s1Runtime = runtimeLatch.promise

const urlsFor = (env: TinyFiregridHostEnv, probe: string): GenerationUrls => ({
  engineStreamUrl: durableStreamUrl(
    env.durableStreamsBaseUrl,
    `${env.namespace}.s1.${env.runId}.${probe}.engine`,
  ),
  inputStreamUrl: durableStreamUrl(
    env.durableStreamsBaseUrl,
    `${env.namespace}.s1.${env.runId}.${probe}.input`,
  ),
})

const annotateObservation = (phase: string, obs: ExecObservation) =>
  Effect.annotateCurrentSpan({
    [`firegrid.s1.${phase}.execution_exists`]: obs.executionExists,
    [`firegrid.s1.${phase}.suspended`]: obs.suspended ?? false,
    [`firegrid.s1.${phase}.has_final_result`]: obs.hasFinalResult,
    [`firegrid.s1.${phase}.deferred_count`]: obs.deferredCount,
    [`firegrid.s1.${phase}.input_processed`]: obs.processed,
  })

// Probe A — crash between write and resume (the lost-wakeup half of Q3 §3).
// gen1: start (no input) -> park; write input row; DROP the process before any
// engine.resume (the wake-up signal is lost to the crash). gen2: reconstruct
// and DO NOTHING but wait — the restart recovery sweep re-drives the parked
// body once the workflow registers, the body reads the now-durable input and
// completes. The lost resume is supplied by the engine itself.
const probeA = (env: TinyFiregridHostEnv): Effect.Effect<ProbeResult, unknown> =>
  Effect.gen(function*() {
    const urls = urlsFor(env, "probe-a")
    const id = "a"
    const value = "delivered-by-A"
    const executionId = yield* WakeWorkflow.executionId({ id })

    // gen1: park the body, then write the input without resuming, then crash.
    const beforeCrash = yield* runWakeGeneration(urls, ({ engineTable, inputTable }) => Effect.gen(function*() {
      yield* WakeWorkflow.execute({ id }, { discard: true })
      const parked = yield* observeWake(engineTable, inputTable, executionId, id)
      // No settle needed: execute(discard) joins the body fiber, which durably
      // upserts the suspended row before returning.
      // tf-e5rf invariants at the suspend point: parked, no result, NO deferred
      // mailbox, not processed.
      yield* assertHost(
        parked.suspended === true && !parked.hasFinalResult,
        "probe A body did not park on Workflow.suspend",
      )
      yield* assertHost(
        parked.deferredCount === 0,
        "probe A suspension created a deferred mailbox (expected table-wait, no deferred)",
      )
      yield* assertHost(
        !parked.processed,
        "probe A processed the input before any input row existed",
      )
      // Durable write of the workflow-owned input row. NO engine.resume — the
      // wake-up signal is lost to the crash that follows (scope close). The
      // restart recovery sweep is what supplies it on reconstruction.
      yield* inputTable.inputs.insert({ key: id, value })
      yield* Effect.annotateCurrentSpan({
        "firegrid.s1.probe_a.marker": "wrote-input-resume-lost",
      })
      return parked
    }).pipe(Effect.withSpan("firegrid.s1.probe_a.gen1_write_then_crash")))

    // gen2: reconstruct and PASSIVELY wait — no execute/resume. The recovery
    // sweep (recoverSuspendedExecutions) re-drives the parked body on
    // registration; bounded-wait for it to complete, then observe.
    const recovery = yield* runWakeGeneration(urls, ({ engineTable, inputTable }) => Effect.gen(function*() {
      const autoRecovered = yield* awaitFinalResult(
        engineTable,
        executionId,
        Duration.seconds(3),
      )
      const obs = yield* observeWake(engineTable, inputTable, executionId, id)
      yield* annotateObservation("probe_a_after_recovery", obs)
      yield* Effect.annotateCurrentSpan({
        "firegrid.s1.probe_a.marker": "reconstructed-sweep-recovered",
        "firegrid.s1.probe_a.auto_recovered": autoRecovered,
      })
      return { obs, autoRecovered }
    }).pipe(Effect.withSpan("firegrid.s1.probe_a.gen2_reconstruct_auto_recover")))

    return {
      probe: "A",
      beforeCrash,
      afterRecovery: recovery.obs,
      autoRecovered: recovery.autoRecovered,
      recoveredValue: recovery.obs.processedValue,
    }
  }).pipe(Effect.withSpan("firegrid.s1.probe_a"))

// Probe B — restart while parked with input already present (the
// no-restart-sweep half of Q3 §3, now CLOSED). Same setup as A; the claim under
// test is that engine RECONSTRUCTION ALONE re-arms the parked body via the
// recovery sweep, with no external re-drive at all.
const probeB = (env: TinyFiregridHostEnv): Effect.Effect<ProbeResult, unknown> =>
  Effect.gen(function*() {
    const urls = urlsFor(env, "probe-b")
    const id = "b"
    const value = "delivered-by-B"
    const executionId = yield* WakeWorkflow.executionId({ id })

    // gen1: park, write input (now durably present), crash.
    const beforeCrash = yield* runWakeGeneration(urls, ({ engineTable, inputTable }) => Effect.gen(function*() {
      yield* WakeWorkflow.execute({ id }, { discard: true })
      const parked = yield* observeWake(engineTable, inputTable, executionId, id)
      yield* assertHost(
        parked.suspended === true && !parked.hasFinalResult && !parked.processed,
        "probe B body did not park with input absent",
      )
      yield* inputTable.inputs.insert({ key: id, value })
      yield* Effect.annotateCurrentSpan({
        "firegrid.s1.probe_b.marker": "input-present-then-crash",
      })
      return parked
    }).pipe(Effect.withSpan("firegrid.s1.probe_b.gen1_input_present_then_crash")))

    // gen2: reconstruct WITH the input already present. NO execute/resume —
    // the recovery sweep re-arms the body on registration. Bounded-wait for the
    // body to complete and observe that reconstruction alone recovered it.
    const recovery = yield* runWakeGeneration(urls, ({ engineTable, inputTable }) => Effect.gen(function*() {
      const autoRecovered = yield* awaitFinalResult(
        engineTable,
        executionId,
        Duration.seconds(3),
      )
      const obs = yield* observeWake(engineTable, inputTable, executionId, id)
      yield* annotateObservation("probe_b_after_recovery", obs)
      yield* Effect.annotateCurrentSpan({
        "firegrid.s1.probe_b.marker": "reconstructed-sweep-rearmed",
        "firegrid.s1.probe_b.auto_recovered": autoRecovered,
      })
      return { obs, autoRecovered }
    }).pipe(Effect.withSpan("firegrid.s1.probe_b.gen2_reconstruct_auto_recover")))

    return {
      probe: "B",
      beforeCrash,
      afterRecovery: recovery.obs,
      autoRecovered: recovery.autoRecovered,
      recoveredValue: recovery.obs.processedValue,
    }
  }).pipe(Effect.withSpan("firegrid.s1.probe_b"))

// Probe C — contrast control. A DurableClock-parked body. The engine's
// recoverPendingClockWakeups re-arms clock wakeups on reconstruction — the
// recovery mechanism table-waits now also have (recoverSuspendedExecutions).
// Kept green to prove the new sweep did not regress clock recovery.
const probeC = (env: TinyFiregridHostEnv): Effect.Effect<ClockProbeResult, unknown> =>
  Effect.gen(function*() {
    const engineStreamUrl = durableStreamUrl(
      env.durableStreamsBaseUrl,
      `${env.namespace}.s1.${env.runId}.probe-c.engine`,
    )
    const id = "c"
    const executionId = yield* ClockWorkflow.executionId({ id })

    // gen1: park on the durable clock (deadline ~400ms out), crash immediately.
    const before = yield* runClockGeneration(engineStreamUrl, engineTable => Effect.gen(function*() {
      yield* ClockWorkflow.execute({ id }, { discard: true })
      const suspended = yield* isSuspended(engineTable, executionId)
      const pending = yield* pendingClockWakeups(engineTable, executionId)
      yield* Effect.annotateCurrentSpan({
        "firegrid.s1.probe_c.suspended": suspended,
        "firegrid.s1.probe_c.pending_clock_wakeups": pending,
        "firegrid.s1.probe_c.marker": "clock-parked-then-crash",
      })
      return { suspended, pending }
    }).pipe(Effect.withSpan("firegrid.s1.probe_c.gen1_clock_park_then_crash")))

    // gen2: reconstruct. NO explicit resume — recoverPendingClockWakeups
    // re-arms the wakeup, which fires and completes the body asynchronously.
    const autoCompleted = yield* runClockGeneration(engineStreamUrl, engineTable => Effect.gen(function*() {
      const completed = yield* awaitFinalResult(
        engineTable,
        executionId,
        Duration.seconds(3),
      )
      yield* Effect.annotateCurrentSpan({
        "firegrid.s1.probe_c.auto_completed_after_restart": completed,
        "firegrid.s1.probe_c.marker": "reconstructed-clock-auto-fired",
      })
      return completed
    }).pipe(Effect.withSpan("firegrid.s1.probe_c.gen2_reconstruct_auto_recover")))

    return {
      suspendedBeforeCrash: before.suspended,
      pendingClockWakeupBeforeCrash: before.pending,
      autoCompletedAfterRestart: autoCompleted,
    }
  }).pipe(Effect.withSpan("firegrid.s1.probe_c"))

const assertHost = (condition: boolean, message: string) =>
  condition
    ? Effect.void
    : Effect.fail(new Error(`S1 host invariant failed: ${message}`))

export const inputSuspendCrashRecoveryHost = (
  env: TinyFiregridHostEnv,
): Layer.Layer<FiregridHost, unknown, never> =>
  Layer.scopedDiscard(
    Effect.sync(() => {
      runtimeLatch.resolve({
        runProbeA: probeA(env),
        runProbeB: probeB(env),
        runProbeC: probeC(env),
      })
    }),
  ) as unknown as Layer.Layer<FiregridHost, unknown, never>
