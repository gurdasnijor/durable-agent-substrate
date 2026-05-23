import {
  Activity,
  Workflow,
} from "@effect/workflow"
import { Duration, Effect, Option, Schema, Stream } from "effect"
import {
  evaluateFieldEquals,
  FieldEqualsTriggerSchema,
} from "../../transforms/field-equals.ts"
import {
  RuntimeChannelRouter,
  type RuntimeChannelRoute,
} from "../../channels/router.ts"

// tf-0xe4: one (channel, trigger) pair the workflow races. wait_for is one
// pair; wait_for_any is the primary `channel`/`trigger` plus
// `additionalSources`. The wait/child-output deletion wave replaced the
// previous `RuntimeObservationSource` discriminator (`AgentOutput*` /
// `RuntimeRun` / `CallerFact`) with the existing channel target string —
// observation now goes through `RuntimeChannelRouter` exactly like every
// other wait/child-output dispatch (proven by tf-22fo + the shape-c
// channel-router-turn FINDING). Cannon §C6: "typed source + cursor + match"
// is expressed as the route's stream + the trigger predicate.
const WaitForWorkflowSourceSchema = Schema.Struct({
  channel: Schema.String.pipe(Schema.minLength(1)),
  trigger: FieldEqualsTriggerSchema,
})

type WaitForWorkflowSource = Schema.Schema.Type<
  typeof WaitForWorkflowSourceSchema
>

export const WaitForWorkflowPayloadSchema = Schema.Struct({
  executionKey: Schema.String,
  source: WaitForWorkflowSourceSchema,
  // tf-0xe4: extra sources for a durable wait_for_any race. The workflow races
  // the primary source plus these inside one journaled Activity, so the race
  // survives host restart instead of being lost with an in-memory raceAll.
  additionalSources: Schema.optional(Schema.Array(WaitForWorkflowSourceSchema)),
  timeoutMs: Schema.optional(Schema.Number),
})

export const WaitForWorkflowMatchOutcomeSchema = Schema.TaggedStruct("Match", {
  raw: Schema.Unknown,
  // tf-0xe4: index of the winning source in [source, ...additionalSources].
  // 0 for single wait_for; the racing position for wait_for_any.
  winnerIndex: Schema.optional(Schema.Number),
})

export const WaitForWorkflowTimeoutOutcomeSchema = Schema.TaggedStruct("Timeout", {})

export const WaitForWorkflowOutcomeSchema = Schema.Union(
  WaitForWorkflowMatchOutcomeSchema,
  WaitForWorkflowTimeoutOutcomeSchema,
)

export type WaitForWorkflowPayload = Schema.Schema.Type<
  typeof WaitForWorkflowPayloadSchema
>

export type WaitForWorkflowOutcome = Schema.Schema.Type<
  typeof WaitForWorkflowOutcomeSchema
>

export const waitForWorkflowExecutionId = (executionKey: string): string =>
  `wait-for:${executionKey}`

export const WaitForWorkflow = Workflow.make({
  name: "firegrid.agent_tools.wait_for",
  payload: WaitForWorkflowPayloadSchema,
  success: WaitForWorkflowOutcomeSchema,
  error: Schema.Never,
  idempotencyKey: ({ executionKey }) => waitForWorkflowExecutionId(executionKey),
})

// The route's `stream` field is populated by `runtimeRouteFromChannel` for
// every ingress/bidirectional channel registration (router.ts:227). Factory-
// keyed ingress routes (`runtimeRouteFromFactoryIngressChannel`) intentionally
// omit `stream` because they require an input payload to resolve the per-key
// channel; the agent-surface `wait_for` tool only addresses non-factory
// channels today (see tool-use-to-effect.ts:runWaitForTool comment).
const ingressStreamForChannel = (
  route: RuntimeChannelRoute,
  channel: string,
): Effect.Effect<Stream.Stream<unknown, unknown, never>> => {
  const stream = route.stream
  if (stream === undefined) {
    return Effect.dieMessage(
      `WaitForWorkflow: channel ${channel} is not an ingress-shaped route ` +
        "(no stream binding). Factory-keyed channels are not reachable from " +
        "the agent wait_for surface today.",
    )
  }
  return Effect.succeed(stream)
}

const matchActivityName = (executionKey: string): string =>
  `wait-for-workflow.match/${executionKey}`

const matchOrTimeoutActivity = (
  executionKey: string,
  sources: ReadonlyArray<WaitForWorkflowSource>,
  timeoutMs: number | undefined,
) =>
  Activity.make({
    name: matchActivityName(executionKey),
    success: WaitForWorkflowOutcomeSchema,
    execute: Effect.gen(function*() {
      const router = yield* RuntimeChannelRouter
      // tf-0xe4: race all sources inside the Activity. Each source resolves to
      // the per-channel ingress stream through the same `RuntimeChannelRouter`
      // every other wait/child-output dispatch crosses; re-running this
      // Activity on workflow resume re-subscribes and re-finds the winner so
      // the race survives host restart (the in-memory raceAll did not).
      const matches = sources.map((entry, winnerIndex) =>
        Effect.gen(function*() {
          const route = yield* router.route(entry.channel)
          const stream = yield* ingressStreamForChannel(route, entry.channel)
          const row = yield* Stream.runHead(
            stream.pipe(
              Stream.filter(value => evaluateFieldEquals(entry.trigger, value)),
            ),
          )
          // Single-source wait_for omits winnerIndex (outcome unchanged); only
          // a multi-source wait_for_any race reports the winning index.
          return yield* Option.match(row, {
            onNone: () => Effect.never as Effect.Effect<WaitForWorkflowOutcome>,
            onSome: (raw): Effect.Effect<WaitForWorkflowOutcome> =>
              Effect.succeed(
                sources.length > 1
                  ? { _tag: "Match", raw, winnerIndex }
                  : { _tag: "Match", raw },
              ),
          })
        }))
      const match = Effect.raceAll(matches)

      if (timeoutMs === undefined) return yield* match

      return yield* Effect.race(
        match,
        Effect.sleep(Duration.millis(timeoutMs)).pipe(
          Effect.as<WaitForWorkflowOutcome>({ _tag: "Timeout" }),
        ),
      )
    }).pipe(
      Effect.orDie,
      Effect.withSpan("firegrid.agent_tools.wait_for.workflow.match_activity", {
        kind: "internal",
        attributes: {
          "firegrid.agent_tools.wait_for.execution_key": executionKey,
          "firegrid.wait.channel": sources[0]!.channel,
          "firegrid.wait.source_count": sources.length,
          "firegrid.wait.has_timeout": timeoutMs !== undefined,
        },
      }),
    ),
  })

export const WaitForWorkflowLayer = WaitForWorkflow.toLayer(({
  executionKey,
  source,
  additionalSources,
  timeoutMs,
}) => {
  const sources: ReadonlyArray<WaitForWorkflowSource> = [
    source,
    ...(additionalSources ?? []),
  ]
  const activity = matchOrTimeoutActivity(executionKey, sources, timeoutMs)

  return activity.pipe(
    Effect.withSpan("firegrid.agent_tools.wait_for.workflow.body", {
      kind: "internal",
      attributes: {
        "firegrid.agent_tools.wait_for.execution_key": executionKey,
        "firegrid.wait.channel": source.channel,
        "firegrid.wait.source_count": sources.length,
        "firegrid.wait.has_timeout": timeoutMs !== undefined,
        ...(timeoutMs === undefined ? {} : { "firegrid.wait.timeout_ms": timeoutMs }),
      },
    }),
  )
})
