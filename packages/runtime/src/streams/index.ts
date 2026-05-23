// wait/child-output streams deletion: `RuntimeObservationStreams` /
// `RuntimeObservationStreamsLive` / `RuntimeObservationSource(Schema)` are
// gone. The agent `wait_for` tool and the WaitForWorkflow Activity now reach
// sources through `RuntimeChannelRouter`. `CallerOwnedFactStreams` survives
// as the PARK blocker — a handful of tiny-firegrid simulations still build
// the Layer; production no longer reads it.
export {
  CallerOwnedFactStreams,
  type CallerOwnedFactStreamsService,
} from "./runtime-observation-streams.ts"
