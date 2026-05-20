import {
  Activity,
  DurableClock,
  DurableDeferred,
  Workflow,
} from "@effect/workflow"
import {
  RuntimeAgentOutputAfterEvents,
  RuntimeAgentOutputEvents,
  RuntimeRuns,
} from "@firegrid/runtime"
import {
  type RuntimeWaitSource,
  RuntimeWaitSourceSchema,
  type WaitForToolOutput,
  WaitForToolOutputSchema,
} from "@firegrid/protocol/agent-tools"
import {
  CallerOwnedFactStreams,
  evaluateFieldEquals,
  FieldEqualsTriggerSchema,
  type FieldEqualsTrigger,
} from "@firegrid/runtime/durable-tools"
import { Duration, Effect, Option, Schema, Stream } from "effect"

const WaitForWorkflowPayloadSchema = Schema.Struct({
  executionId: Schema.String,
  source: RuntimeWaitSourceSchema,
  trigger: FieldEqualsTriggerSchema,
  timeoutMs: Schema.optional(Schema.Number),
})

type WaitForWorkflowPayload = Schema.Schema.Type<
  typeof WaitForWorkflowPayloadSchema
>

export const waitForWorkflowExecutionId = (
  contextId: string,
  toolUseId: string,
): string => `wait:${contextId}:${toolUseId}`

export const WaitForWorkflow = Workflow.make({
  name: "firegrid.agent_tools.wait_for",
  payload: WaitForWorkflowPayloadSchema,
  success: WaitForToolOutputSchema,
  idempotencyKey: ({ executionId }) => executionId,
})

const contextIdPredicate = (
  trigger: FieldEqualsTrigger,
): string | undefined => {
  const predicate = trigger.find((predicate) =>
    predicate.path.length === 1 &&
    predicate.path[0] === "contextId" &&
    typeof predicate.equals === "string"
  )
  return typeof predicate?.equals === "string" ? predicate.equals : undefined
}

const sourceStreamFor = (
  source: RuntimeWaitSource,
  trigger: FieldEqualsTrigger,
): Effect.Effect<Stream.Stream<unknown, unknown>> =>
  Effect.gen(function* () {
    switch (source._tag) {
      case "AgentOutput": {
        const contextId = contextIdPredicate(trigger)
        if (contextId === undefined) return Stream.never
        const afterEvents = yield* Effect.serviceOption(RuntimeAgentOutputAfterEvents)
        if (Option.isSome(afterEvents)) {
          return afterEvents.value.forContext(contextId)
        }
        const outputEvents = yield* Effect.serviceOption(RuntimeAgentOutputEvents)
        return Option.match(outputEvents, {
          onNone: () => Stream.never,
          onSome: (events) =>
            events.pipe(Stream.filter((row) => row.contextId === contextId)),
        })
      }
      case "RuntimeRun": {
        const runs = yield* Effect.serviceOption(RuntimeRuns)
        return Option.match(runs, {
          onNone: () => Stream.never,
          onSome: (stream) => stream,
        })
      }
      case "CallerFact": {
        const streams = yield* Effect.serviceOption(CallerOwnedFactStreams)
        return Option.match(streams, {
          onNone: () => Stream.never,
          onSome: (service) => service.streamFor(source.stream),
        })
      }
    }
  })

const matchActivityFor = ({
  executionId,
  source,
  trigger,
}: WaitForWorkflowPayload) =>
  Activity.make({
    name: `wait-for-workflow.match/${executionId}`,
    success: Schema.Unknown,
    execute: Effect.gen(function* () {
      const sourceStream = yield* sourceStreamFor(source, trigger)
      const filteredSource = sourceStream.pipe(
        Stream.filter((row) => evaluateFieldEquals(trigger, row)),
      )
      const first = yield* Stream.runHead(filteredSource)
      return yield* Option.match(first, {
        onNone: () => Effect.never,
        onSome: Effect.succeed,
      })
    }).pipe(
      Effect.orDie,
      Effect.withSpan("firegrid.agent_tools.wait_for.match_activity", {
        kind: "internal",
        attributes: {
          "firegrid.workflow.execution_id": executionId,
          "firegrid.wait.source": source._tag,
        },
      }),
    ),
  })

export const WaitForWorkflowLayer = WaitForWorkflow.toLayer((payload) => {
  const matchSide = matchActivityFor(payload).pipe(
    Effect.map((event): WaitForToolOutput => ({ matched: true, event })),
  )
  const timeoutSide: Effect.Effect<WaitForToolOutput, never> =
    payload.timeoutMs === undefined
      ? Effect.never
      : DurableClock.sleep({
        name: `wait-for-workflow.timeout/${payload.executionId}`,
        duration: Duration.millis(payload.timeoutMs),
        inMemoryThreshold: Duration.zero,
      }).pipe(
        Effect.as<WaitForToolOutput>({ matched: false, timedOut: true }),
      )

  return DurableDeferred.raceAll({
    name: `wait-for-workflow.race/${payload.executionId}`,
    success: WaitForToolOutputSchema,
    error: Schema.Never,
    effects: [matchSide, timeoutSide],
  }).pipe(
    Effect.withSpan("firegrid.agent_tools.wait_for.workflow_body", {
      kind: "internal",
      attributes: {
        "firegrid.workflow.execution_id": payload.executionId,
        "firegrid.wait.source": payload.source._tag,
        "firegrid.wait.has_timeout": payload.timeoutMs !== undefined,
      },
    }),
  )
})
