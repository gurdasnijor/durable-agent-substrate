import { WorkflowEngine } from "@effect/workflow"
import { DurableStreamTestServer } from "@durable-streams/server"
import { makeIngressChannel } from "@firegrid/protocol/channels"
import { Effect, Layer, Schema, Stream } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  RuntimeChannelRouter,
  makeRuntimeChannelRouter,
  runtimeRouteFromChannel,
  type RuntimeChannelRoute,
} from "../../../src/channels/router.ts"
import {
  DurableStreamsWorkflowEngine,
} from "../../../src/workflow-engine/DurableStreamsWorkflowEngine.ts"
import {
  WaitForWorkflow,
  WaitForWorkflowLayer,
  waitForWorkflowExecutionId,
} from "../../../src/workflow-engine/workflows/index.ts"

// wait/child-output streams deletion: this test previously injected a
// synthetic `RuntimeObservationStreams` and let the WaitForWorkflow resolve a
// `CallerFact` source through it. The workflow now reads its sources through
// `RuntimeChannelRouter`, so the test fixture is a channel router with
// purpose-built ingress routes — every wait/child-output dispatch in
// production crosses the same surface.

const RowSchema = Schema.Struct({
  kind: Schema.optional(Schema.String),
  correlationId: Schema.String,
  payload: Schema.optional(Schema.Number),
})

const ingressRouteFromStream = (
  target: string,
  stream: Stream.Stream<unknown, unknown, never>,
): RuntimeChannelRoute<unknown, unknown> =>
  runtimeRouteFromChannel(
    makeIngressChannel({
      target,
      schema: RowSchema,
      sourceClass: "static-source",
      stream: stream as Stream.Stream<
        Schema.Schema.Type<typeof RowSchema>,
        unknown,
        never
      >,
    }),
  )

const matchFactsRouter = makeRuntimeChannelRouter([
  ingressRouteFromStream(
    "facts",
    Stream.fromIterable([
      { kind: "ignore", correlationId: "decoy" },
      { kind: "match", correlationId: "target", payload: 42 },
    ]),
  ),
  ingressRouteFromStream("empty", Stream.empty),
])

const matchFactsRouterLayer = Layer.succeed(RuntimeChannelRouter, matchFactsRouter)

const waitForWorkflowTestLayer = WaitForWorkflowLayer.pipe(
  Layer.provideMerge(matchFactsRouterLayer),
  Layer.provideMerge(WorkflowEngine.layerMemory),
)

describe("WaitForWorkflow", () => {
  it("firegrid-workflow-driven-runtime.PHASE_1_CONTEXT_WORKFLOW.10 matches a channel-router ingress row through the workflow engine", async () => {
    const outcome = await Effect.runPromise(
      Effect.scoped(
        WaitForWorkflow.execute({
          executionKey: "wf-match",
          source: {
            channel: "facts",
            trigger: [{ path: ["correlationId"], equals: "target" }],
          },
          timeoutMs: 60_000,
        }).pipe(
          Effect.provide(waitForWorkflowTestLayer),
          Effect.provideService(RuntimeChannelRouter, matchFactsRouter),
        ),
      ),
    )

    expect(outcome).toEqual({
      _tag: "Match",
      raw: { kind: "match", correlationId: "target", payload: 42 },
    })
  })

  it("returns Timeout when no row arrives before the per-Activity-attempt timeout", async () => {
    const outcome = await Effect.runPromise(
      Effect.scoped(
        WaitForWorkflow.execute({
          executionKey: "wf-timeout",
          source: {
            channel: "empty",
            trigger: [{ path: ["correlationId"], equals: "missing" }],
          },
          timeoutMs: 10,
        }).pipe(
          Effect.provide(waitForWorkflowTestLayer),
          Effect.provideService(RuntimeChannelRouter, matchFactsRouter),
        ),
      ),
    )

    expect(outcome).toEqual({ _tag: "Timeout" })
  })

  it("uses the stable wait-for workflow execution id prefix", () => {
    expect(waitForWorkflowExecutionId("wf-match")).toBe("wait-for:wf-match")
  })

  // tf-0xe4: wait_for_any races the primary source plus additionalSources inside
  // the one workflow Activity and reports the winning index.
  it("tf-0xe4 races multiple sources and returns the winning index", async () => {
    const router = makeRuntimeChannelRouter([
      ingressRouteFromStream("s0", Stream.empty), // never matches
      ingressRouteFromStream(
        "s1",
        Stream.fromIterable([{ correlationId: "target", payload: 7 }]),
      ),
    ])
    const layer = WaitForWorkflowLayer.pipe(
      Layer.provideMerge(Layer.succeed(RuntimeChannelRouter, router)),
      Layer.provideMerge(WorkflowEngine.layerMemory),
    )
    const outcome = await Effect.runPromise(
      Effect.scoped(
        WaitForWorkflow.execute({
          executionKey: "wf-any-race",
          source: {
            channel: "s0",
            trigger: [{ path: ["correlationId"], equals: "target" }],
          },
          additionalSources: [{
            channel: "s1",
            trigger: [{ path: ["correlationId"], equals: "target" }],
          }],
          timeoutMs: 60_000,
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(RuntimeChannelRouter, router),
        ),
      ),
    )
    expect(outcome).toEqual({
      _tag: "Match",
      raw: { correlationId: "target", payload: 7 },
      winnerIndex: 1,
    })
  })
})

// tf-0xe4: the durability proof — a completed wait_for_any race is persisted in
// the durable workflow engine and replays across engine reconstruction (a fresh
// engine over the same durable state returns the journaled winner even when the
// live source no longer matches). The in-memory Effect.raceAll it replaces had
// no execution row to reconstruct, so it was lost on host restart.
describe("WaitForWorkflow durable wait_for_any restart", () => {
  let server: DurableStreamTestServer | undefined
  let baseUrl: string | undefined
  beforeEach(async () => {
    server = new DurableStreamTestServer({ port: 0, host: "127.0.0.1" })
    baseUrl = await server.start()
  })
  afterEach(async () => {
    await server?.stop()
    server = undefined
    baseUrl = undefined
  })

  const emptyRouter = makeRuntimeChannelRouter([
    ingressRouteFromStream("s0", Stream.empty),
    ingressRouteFromStream("s1", Stream.empty),
  ])

  const runGeneration = <A>(
    streamUrl: string,
    router: ReturnType<typeof makeRuntimeChannelRouter>,
    effect: Effect.Effect<A, unknown, RuntimeChannelRouter | WorkflowEngine.WorkflowEngine>,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(
        effect.pipe(
          Effect.provide(
            WaitForWorkflowLayer.pipe(
              Layer.provideMerge(Layer.succeed(RuntimeChannelRouter, router)),
              Layer.provideMerge(
                DurableStreamsWorkflowEngine.layer({ streamUrl }) as Layer.Layer<never, unknown, unknown>,
              ),
            ),
          ),
          Effect.provideService(RuntimeChannelRouter, router),
        ) as Effect.Effect<A, unknown, never>,
      ),
    )

  it("tf-0xe4 a completed wait_for_any race survives engine reconstruction (replay from durable state)", async () => {
    if (!baseUrl) throw new Error("server not started")
    const streamUrl = `${baseUrl}/v1/stream/wait-any-restart-${crypto.randomUUID()}`
    const payload = {
      executionKey: "wf-any-restart",
      source: {
        channel: "s0",
        trigger: [{ path: ["correlationId"], equals: "target" }],
      },
      additionalSources: [{
        channel: "s1",
        trigger: [{ path: ["correlationId"], equals: "target" }],
      }],
    }

    // Generation 1: channel s1 matches -> the durable workflow races and
    // completes with the winning index, persisting the result.
    const matchRouter = makeRuntimeChannelRouter([
      ingressRouteFromStream("s0", Stream.empty),
      ingressRouteFromStream(
        "s1",
        Stream.fromIterable([{ correlationId: "target", payload: 99 }]),
      ),
    ])
    const first = await runGeneration(
      streamUrl,
      matchRouter,
      WaitForWorkflow.execute(payload),
    )
    expect(first).toEqual({
      _tag: "Match",
      raw: { correlationId: "target", payload: 99 },
      winnerIndex: 1,
    })

    // Generation 2 (host restart): a freshly reconstructed engine over the same
    // durable state, now with NO matching channel. Re-executing the same
    // execution returns the journaled result from durable state — if the race
    // were in-memory (the old Effect.raceAll) or re-run here, the empty channel
    // would never match. This is the survives-restart property.
    const replayed = await runGeneration(
      streamUrl,
      emptyRouter,
      WaitForWorkflow.execute(payload),
    )
    expect(replayed).toEqual({
      _tag: "Match",
      raw: { correlationId: "target", payload: 99 },
      winnerIndex: 1,
    })
  }, 20_000)
})
