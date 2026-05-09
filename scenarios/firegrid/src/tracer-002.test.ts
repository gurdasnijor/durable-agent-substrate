import { DurableStream } from "@durable-streams/client"
import { DurableStreamTestServer } from "@durable-streams/server"
import { createStreamDB } from "@durable-streams/state"
import { NodeContext } from "@effect/platform-node"
import {
  Firegrid,
  FiregridConfig,
  FiregridLive,
  local,
} from "@firegrid/client"
import { sessionStateSchema } from "@firegrid/protocol/session"
import {
  materializeRuntimeOutputToSession,
  exampleJsonlSessionMaterializer,
  readRuntimeJournal,
  StateProtocolProducerLive,
} from "@firegrid/runtime/data-plane/materialization"
import {
  startRuntime,
} from "@firegrid/runtime"
import {
  LocalProcessSandboxProviderLive,
} from "@firegrid/runtime/data-plane/execution/sandbox"
import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

let server: DurableStreamTestServer | undefined

beforeEach(async () => {
  server = new DurableStreamTestServer({ port: 0, host: "127.0.0.1" })
  await server.start()
})

afterEach(async () => {
  await server?.stop()
  server = undefined
})

const createStreamUrl = async (name: string): Promise<string> => {
  if (!server) throw new Error("server not started")
  const streamUrl = `${server.url}/v1/stream/${name}-${crypto.randomUUID()}`
  await DurableStream.create({
    url: streamUrl,
    contentType: "application/json",
  })
  return streamUrl
}

const runWithFiregrid = <A, E>(
  options: {
    readonly controlPlaneStreamUrl: string
    readonly dataPlaneStreamUrl: string
  },
  effect: Effect.Effect<A, E, Firegrid>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        FiregridLive.pipe(
          Layer.provide(Layer.succeed(FiregridConfig, {
            runtimeStreamUrl: options.controlPlaneStreamUrl,
            controlPlaneStreamUrl: options.controlPlaneStreamUrl,
            dataPlaneStreamUrl: options.dataPlaneStreamUrl,
          })),
        ),
      ),
    ),
  )

describe("firegrid tracer 002 scenario", () => {
  test("durable-records-and-projections.PROJECTIONS.3 materializes retained runtime output into idempotent session state", async () => {
    const controlPlaneStreamUrl = await createStreamUrl("runtime-control")
    const dataPlaneStreamUrl = await createStreamUrl("runtime-output")
    const workflowStreamUrl = await createStreamUrl("workflow")
    const sessionStreamUrl = await createStreamUrl("firegrid-session")
    const childCode = `
console.log(JSON.stringify({ type: "assistant", text: "pong" }))
console.error("diagnostic: tracer-002")
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

    const runtime = await Effect.runPromise(
      startRuntime({
        runtimeStreamUrl: controlPlaneStreamUrl,
        dataPlaneStreamUrl,
        workflowStreamUrl,
        contextId: handle.contextId,
      }).pipe(
        Effect.provide(Layer.mergeAll(
          LocalProcessSandboxProviderLive,
          NodeContext.layer,
        )),
      ),
    )

    expect(runtime).toMatchObject({
      contextId: handle.contextId,
      exitCode: 0,
    })

    const retainedJournal = await Effect.runPromise(readRuntimeJournal({
      streamUrl: dataPlaneStreamUrl,
    }))
    const sourceEvent = retainedJournal.find(event =>
      event.type === "firegrid.runtime.output.stdout" &&
      event.event.contextId === handle.contextId)
    expect(sourceEvent).toBeDefined()

    const materialize = materializeRuntimeOutputToSession({
      sourceDataPlaneStreamUrl: dataPlaneStreamUrl,
      targetSessionStreamUrl: sessionStreamUrl,
      contextId: handle.contextId,
      materializer: exampleJsonlSessionMaterializer,
    }).pipe(
      Effect.provide(StateProtocolProducerLive),
    )

    const firstSummary = await Effect.runPromise(materialize)
    const secondSummary = await Effect.runPromise(materialize)

    expect(firstSummary).toMatchObject({
      rowsRead: 1,
      rowsProjected: 1,
      rowsSkipped: 0,
      rowsFailed: 0,
      changesEmitted: 2,
      failures: [],
    })
    expect(secondSummary).toMatchObject(firstSummary)

    const sessionDb = createStreamDB({
      streamOptions: {
        url: sessionStreamUrl,
        contentType: "application/json",
      },
      state: sessionStateSchema,
    })
    await sessionDb.preload()
    try {
      const sessions = Array.from(sessionDb.collections.sessions.state.values())
      const messages = Array.from(sessionDb.collections.messages.state.values())
      expect(sessions).toHaveLength(1)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        contextId: handle.contextId,
        text: "pong",
        sourceRuntimeEventId: sourceEvent?.id,
      })
    } finally {
      sessionDb.close()
    }
  })
})
