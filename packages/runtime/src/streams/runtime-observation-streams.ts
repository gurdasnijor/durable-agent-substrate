import { Context, type Stream } from "effect"

// wait/child-output streams deletion: the previous content of this file —
// `RuntimeObservationStreams` (a Tag aggregating `agentOutput`,
// `agentOutputAfter`, `runtimeRun`, and `callerFact` Streams), its
// `RuntimeObservationStreamsLive` Layer, and the `RuntimeObservationSource`
// discriminated union — has been removed. The agent's `wait_for` tool and the
// `WaitForWorkflow` Activity now reach sources through `RuntimeChannelRouter`
// directly (verified by the `child-output-existing-channel-router` and
// `shape-c-channel-router-turn` tiny-firegrid simulations).
//
// The `CallerOwnedFactStreams` Tag is retained below as a PARK blocker: a
// handful of tiny-firegrid simulations (notably `dark-factory`) still build
// the Layer, and removing it requires repointing each simulation's
// `DurableTable`-backed fact source through `RuntimeChannelRouter` channel
// registrations. Production no longer reads this Tag — its only previous
// consumer (`RuntimeObservationStreamsLive`) was deleted with this file. New
// production code MUST route caller-owned facts through `RuntimeChannelRouter`
// channel registrations, not this Tag.

/**
 * firegrid-typed-wait-source-redesign.CONTEXT.3
 * firegrid-typed-wait-source-redesign.TYPED_SOURCES.2
 *
 * Host-composition-provided resolver from a caller-owned durable fact
 * stream name to its concrete durable observation Stream. Retained for
 * tiny-firegrid simulations only — production wait/child-output paths route
 * through `RuntimeChannelRouter` ingress route registrations instead.
 */
export interface CallerOwnedFactStreamsService {
  readonly streamFor: (stream: string) => Stream.Stream<unknown, unknown>
}

export class CallerOwnedFactStreams extends Context.Tag(
  "@firegrid/runtime/CallerOwnedFactStreams",
)<CallerOwnedFactStreams, CallerOwnedFactStreamsService>() {}
