import { Console, Effect } from "effect"
import {
  type ClockProbeResult,
  type ProbeResult,
  s1Runtime,
} from "./host.ts"

interface S1Verdict {
  readonly verdict: "GREEN"
  readonly probeA: ProbeResult
  readonly probeB: ProbeResult
  readonly probeC: ClockProbeResult
}

const assertInvariant = (
  condition: boolean,
  message: string,
  detail: unknown,
) =>
  condition
    ? Effect.void
    : Effect.fail(new Error(
      `S1 input-suspend-crash-recovery invariant failed: ${message}; ${
        JSON.stringify(detail)
      }`,
    ))

// tf-12q9 acceptance: with the engine restart recovery sweep
// (recoverSuspendedExecutions) in place, Probes A and B auto-recover after
// reconstruction WITHOUT any explicit test re-drive — the engine itself
// re-arms the parked table-wait body, exactly as it already did for clocks
// (Probe C). The assertions below now require that auto-recovery; a regression
// that drops the sweep (parked body stays unprocessed after reconstruction)
// fails these loudly.
export const inputSuspendCrashRecoveryDriver:
  Effect.Effect<S1Verdict, unknown> = Effect.gen(function*() {
    const runtime = yield* Effect.promise(() => s1Runtime)

    const probeA = yield* runtime.runProbeA
    const probeB = yield* runtime.runProbeB
    const probeC = yield* runtime.runProbeC

    // === Probe A assertions: lost-wakeup recovered by the sweep ===
    yield* assertInvariant(
      probeA.beforeCrash.suspended === true &&
        !probeA.beforeCrash.hasFinalResult &&
        probeA.beforeCrash.deferredCount === 0,
      "probe A: body did not park as a table-wait (no deferred) before crash",
      probeA.beforeCrash,
    )
    yield* assertInvariant(
      probeA.autoRecovered &&
        probeA.afterRecovery.processed &&
        probeA.afterRecovery.hasFinalResult &&
        probeA.afterRecovery.processedValue === "delivered-by-A" &&
        probeA.recoveredValue === "delivered-by-A",
      "probe A: reconstruction did NOT auto-recover the parked body (sweep missing?)",
      probeA,
    )

    // === Probe B assertions: reconstruction-alone re-arms via the sweep ===
    yield* assertInvariant(
      probeB.beforeCrash.suspended === true && !probeB.beforeCrash.hasFinalResult,
      "probe B: body did not park before crash",
      probeB.beforeCrash,
    )
    yield* assertInvariant(
      probeB.autoRecovered &&
        probeB.afterRecovery.processed &&
        probeB.afterRecovery.hasFinalResult &&
        probeB.afterRecovery.processedValue === "delivered-by-B" &&
        probeB.recoveredValue === "delivered-by-B",
      "probe B: reconstruction alone did NOT re-arm the parked body (sweep missing?)",
      probeB,
    )

    // === Probe C assertions: clock auto-recovery still green (no regression) ===
    yield* assertInvariant(
      probeC.suspendedBeforeCrash && probeC.pendingClockWakeupBeforeCrash === 1,
      "probe C: clock body did not park with a pending wakeup before crash",
      probeC,
    )
    yield* assertInvariant(
      probeC.autoCompletedAfterRestart,
      "probe C: clock wakeup did NOT auto-fire on reconstruction (contrast/regression)",
      probeC,
    )

    const verdict: S1Verdict = { verdict: "GREEN", probeA, probeB, probeC }

    yield* Effect.annotateCurrentSpan({
      "firegrid.s1.verdict": verdict.verdict,
      "firegrid.s1.probe_a.auto_recovered_by_sweep": probeA.autoRecovered,
      "firegrid.s1.probe_b.auto_recovered_by_sweep": probeB.autoRecovered,
      "firegrid.s1.probe_c.clock_auto_recovers": probeC.autoCompletedAfterRestart,
    })

    yield* Console.log(
      [
        `S1 input-suspend-crash-recovery: ${verdict.verdict}`,
        "",
        "  axis-2 durability gap — CLOSED by the engine restart recovery sweep:",
        "  Probe A (crash between write & resume):",
        `    before crash:  parked=${probeA.beforeCrash.suspended} deferreds=${probeA.beforeCrash.deferredCount}`,
        `    after restart (NO redrive): processed=${probeA.afterRecovery.processed} value=${probeA.recoveredValue} <- sweep recovered`,
        "  Probe B (restart while parked, input present):",
        `    after restart (NO redrive): processed=${probeB.afterRecovery.processed} value=${probeB.recoveredValue} <- sweep recovered`,
        "  Probe C (clock contrast control):",
        `    clock parked with pending wakeup=${probeC.pendingClockWakeupBeforeCrash}`,
        `    after restart (NO resume): auto-completed=${probeC.autoCompletedAfterRestart} <- clock recovery intact`,
        "",
        "  => table-wait suspensions now get the symmetric restart recovery that",
        "     clocks already had: recoverSuspendedExecutions re-drives every active",
        "     suspended execution on workflow registration (construction/reconstruction).",
      ].join("\n"),
    )

    return verdict
  }).pipe(
    Effect.withSpan("firegrid.s1.verdict", {
      kind: "internal",
      attributes: {
        "firegrid.s1.scope": "input-suspend-crash-recovery",
      },
    }),
  )
