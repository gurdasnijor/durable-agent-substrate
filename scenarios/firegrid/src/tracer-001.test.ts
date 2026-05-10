import {
  Firegrid,
  local,
} from "@firegrid/client"
import {
  FiregridRuntimeHostLive,
  startRuntime,
} from "@firegrid/runtime"
import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  startFiregridScenarioHarness,
  type FiregridScenarioHarness,
} from "./scenario-harness.ts"

let harness: FiregridScenarioHarness | undefined

beforeEach(async () => {
  harness = await startFiregridScenarioHarness()
})

afterEach(async () => {
  await harness?.stop()
  harness = undefined
})

const createStreamUrl = async (name: string): Promise<string> => {
  if (!harness) throw new Error("scenario harness not started")
  return harness.createStreamUrl(name)
}

const runWithFiregrid = <A, E>(
  options: {
    readonly controlPlaneStreamUrl: string
    readonly dataPlaneStreamUrl: string
  },
  effect: Effect.Effect<A, E, Firegrid>,
): Promise<A> => {
  if (!harness) throw new Error("scenario harness not started")
  return harness.runWithFiregrid(options, effect)
}

describe("firegrid tracer scenarios", () => {
  it("firegrid-durable-launch-runtime-operator.LAUNCH_OPERATOR.10 starts from public launch and journals retained runtime events/logs", async () => {
    const controlPlaneStreamUrl = await createStreamUrl("runtime-control")
    const dataPlaneStreamUrl = await createStreamUrl("runtime-data")
    const workflowStreamUrl = await createStreamUrl("workflow")
    const childCode = `
console.log(JSON.stringify({ type: "assistant", text: "pong" }))
console.error("diagnostic: client-to-runtime")
`

    const handle = await runWithFiregrid(
      { controlPlaneStreamUrl, dataPlaneStreamUrl },
      Effect.gen(function* () {
        const firegrid = yield* Firegrid
        return yield* firegrid.launch({
          runtime: local.jsonl({
            argv: [process.execPath, "--input-type=module", "-e", childCode],
          }),
        })
      }),
    )

    const result = await Effect.runPromise(
      startRuntime({
        contextId: handle.contextId,
      }).pipe(
        // firegrid-durable-launch-runtime-operator.RUNTIME_HOST.4
        Effect.provide(FiregridRuntimeHostLive({
          streams: {
            workflow: workflowStreamUrl,
            controlPlane: controlPlaneStreamUrl,
            runtimeOutput: dataPlaneStreamUrl,
            requiredActions: await createStreamUrl("runtime-host-required-actions"),
          },
        })),
      ),
    )

    expect(result).toMatchObject({
      contextId: handle.contextId,
      exitCode: 0,
    })

    const snapshot = await runWithFiregrid(
      { controlPlaneStreamUrl, dataPlaneStreamUrl },
      Effect.gen(function* () {
        const firegrid = yield* Firegrid
        return yield* firegrid.open(handle.contextId).snapshot
      }),
    )

    expect(snapshot.events).toContainEqual(expect.objectContaining({
      contextId: handle.contextId,
      source: "stdout",
      raw: "{\"type\":\"assistant\",\"text\":\"pong\"}",
    }))
    expect(snapshot.logs).toContainEqual(expect.objectContaining({
      contextId: handle.contextId,
      source: "stderr",
      raw: "diagnostic: client-to-runtime",
    }))
  })
})
