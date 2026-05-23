import {
  VerifiedWebhookFactChannel,
  VerifiedWebhookFactChannelTarget,
  makeIngressChannel,
  type ChannelTarget,
  type IngressChannel,
} from "@firegrid/protocol/channels"
import {
  VerifiedWebhookFactSchema,
} from "@firegrid/protocol/verified-webhook"
import {
  VerifiedWebhookFactTable,
  type VerifiedWebhookFactTableService,
} from "@firegrid/runtime/verified-webhook-ingest"
import { Effect, Layer, Schema, Stream } from "effect"

// wait/child-output streams deletion: `VerifiedWebhookFactCallerOwnedFactStreamsLive`
// is gone. It adapted this channel's binding stream into `CallerOwnedFactStreams`
// for the deleted `RuntimeObservationStreams` aggregator. The agent's
// `wait_for` tool now resolves channels through `RuntimeChannelRouter`
// directly, and `VerifiedWebhookFactChannelLive` is registered as a route on
// that router by host composition — no adapter required.

export const verifiedWebhookFactRows = <S extends Schema.Schema.AnyNoContext>(
  table: VerifiedWebhookFactTableService,
  schema: S,
): Stream.Stream<Schema.Schema.Type<S>, unknown, never> =>
  (table.verifiedWebhookFacts.rows() as Stream.Stream<unknown, unknown, never>)
    .pipe(
      Stream.filterMap(Schema.decodeUnknownOption(schema)),
    ) as Stream.Stream<Schema.Schema.Type<S>, unknown, never>

export const verifiedWebhookFactChannel = <S extends Schema.Schema.AnyNoContext>(
  table: VerifiedWebhookFactTableService,
  options: {
    readonly schema: S
    readonly target?: ChannelTarget | string
  },
): IngressChannel<S> =>
  makeIngressChannel({
    target: options.target ?? VerifiedWebhookFactChannelTarget,
    schema: options.schema,
    sourceClass: "static-source",
    stream: verifiedWebhookFactRows(table, options.schema).pipe(
      Stream.withSpan("firegrid.host.channel.verified_webhook", {
        kind: "internal",
      }),
    ),
  })

export const VerifiedWebhookFactChannelLive = Layer.effect(
  VerifiedWebhookFactChannel,
  Effect.gen(function*() {
    const table = yield* VerifiedWebhookFactTable
    return verifiedWebhookFactChannel(table, {
      schema: VerifiedWebhookFactSchema,
    })
  }),
)
