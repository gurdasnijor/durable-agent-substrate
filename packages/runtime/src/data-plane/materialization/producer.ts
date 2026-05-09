import { IdempotentProducer } from "@durable-streams/client"
import { sessionStateSchema } from "@firegrid/protocol/session"
import type { Scope } from "effect"
import { Context, Effect, Layer, Schema } from "effect"
import type {
  MaterializerChange,
  RuntimeOutputMaterializer,
} from "./types.ts"
import { makeJsonDurableStream } from "../stream.ts"

export class ProducerError extends Schema.TaggedError<ProducerError>()(
  "ProducerError",
  {
    op: Schema.String,
    producerId: Schema.optional(Schema.String),
    cause: Schema.Unknown,
  },
) {}

export interface StateProtocolProducerHandle {
  readonly append: (event: unknown) => Effect.Effect<void, ProducerError>
  readonly flush: Effect.Effect<void, ProducerError>
}

export interface StateProtocolProducerOpenOptions {
  readonly streamUrl: string
  readonly producerId: string
}

export class StateProtocolProducer extends Context.Tag("firegrid/StateProtocolProducer")<
  StateProtocolProducer,
  {
    readonly open: (
      options: StateProtocolProducerOpenOptions,
    ) => Effect.Effect<StateProtocolProducerHandle, ProducerError, Scope.Scope>
  }
>() {}

export const producerIdFor = (
  materializer: RuntimeOutputMaterializer,
  contextId: string,
): string =>
  `session-materializer:${materializer.name}:${materializer.version}:${contextId}`

export const toSessionStateEvent = (
  change: MaterializerChange,
  materializer: RuntimeOutputMaterializer,
): unknown => {
  switch (change.kind) {
    case "upsertSession":
      return sessionStateSchema.sessions.upsert({
        value: change.value,
        headers: {
          txid: `${materializer.name}:${materializer.version}:session:${change.value.sessionId}`,
        },
      })
    case "upsertMessage":
      return sessionStateSchema.messages.upsert({
        value: change.value,
        headers: {
          txid: `${materializer.name}:${materializer.version}:message:${change.value.messageId}`,
        },
      })
  }
}

export const StateProtocolProducerLive = Layer.succeed(
  StateProtocolProducer,
  StateProtocolProducer.of({
    open: options =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const errors: Array<Error> = []
          const stream = makeJsonDurableStream(options.streamUrl)
          const producer = new IdempotentProducer(
            stream,
            options.producerId,
            {
              autoClaim: true,
              lingerMs: 10,
              onError: error => {
                errors.push(error)
              },
            },
          )

          const drainErrors = (
            op: string,
          ): Effect.Effect<void, ProducerError> =>
            errors.length === 0
              ? Effect.void
              : Effect.fail(new ProducerError({
                op,
                producerId: options.producerId,
                cause: errors.shift() ?? new Error("unknown state protocol producer error"),
              }))

          return { producer, drainErrors }
        }),
        ({ producer }) =>
          Effect.tryPromise({
            try: () => producer.detach(),
            catch: cause =>
              new ProducerError({
                op: "state-protocol.detach",
                producerId: options.producerId,
                cause,
              }),
          }).pipe(Effect.ignore),
      ).pipe(
        Effect.map(({ producer, drainErrors }) => ({
          append: event =>
            Effect.try({
              try: () => producer.append(JSON.stringify(event)),
              catch: cause =>
                new ProducerError({
                  op: "state-protocol.append",
                  producerId: options.producerId,
                  cause,
                }),
            }).pipe(Effect.zipRight(drainErrors("state-protocol.append"))),
          flush: Effect.tryPromise({
            try: () => producer.flush(),
            catch: cause =>
              new ProducerError({
                op: "state-protocol.flush",
                producerId: options.producerId,
                cause,
              }),
          }).pipe(Effect.zipRight(drainErrors("state-protocol.flush"))),
        })),
      ),
  }),
)
