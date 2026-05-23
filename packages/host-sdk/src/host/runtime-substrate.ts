import { Layer } from "effect"
import {
  RuntimeControlPlaneRecorderLive,
} from "@firegrid/runtime/control-plane"
import {
  type CurrentHostSession,
  type RuntimeControlPlaneTable,
  type RuntimeOutputTable,
} from "@firegrid/protocol/launch"
import { type RuntimeHostConfig } from "./config.ts"
import {
  type RuntimeAgentOutputAfterEvents,
  RuntimeAgentOutputEventsLayer,
} from "@firegrid/runtime/runtime-output"
import {
  type RuntimeContextStateStore,
} from "@firegrid/runtime/kernel"
import {
  PerContextRuntimeAgentOutputAfterEventsLive,
  RuntimeContextStateStoreLive,
} from "./per-context-runtime-output.ts"
import {
  SessionAgentOutputChannelLive,
} from "./channels/session-agent-output/index.ts"

// TFIND-031: the host-provided runtime context that a per-context
// workflow execution genuinely requires. Deferred-execution seams
// (`Effect.context<…>()` captured at Layer-build time and re-provided
// into closures that run later) MUST capture this set instead of
// `never`. These tags are always satisfied at runtime by the composed
// Firegrid host layer (`FiregridRuntimeHostLive`); annotating `never`
// was only ever sound because `DurableTable.layer` leaked `any` and
// collapsed the requirements channel. With precise `.layer` typing the
// real requirement surfaces — declare it honestly here rather than
// re-erase it.
export type HostRuntimeContextExecutionEnv =
  | RuntimeControlPlaneTable
  | RuntimeOutputTable
  | RuntimeAgentOutputAfterEvents
  | RuntimeContextStateStore
  | CurrentHostSession
  | RuntimeHostConfig

// firegrid-runtime-boundary-reconciliation.HOST_HARDENING.2
// firegrid-typed-wait-source-redesign.WAIT_ROUTER.1
// firegrid-typed-wait-source-redesign.REJECTION.2
// Shared host runtime observation substrate used by workflow support layers.
// wait/child-output streams deletion: this layer no longer composes the
// deleted `RuntimeObservationStreamsLive` aggregator. WaitForWorkflow's
// Activity now reads each source through `RuntimeChannelRouter`, so the
// host-side ingress channels are surfaced as routes (see
// `host-control-routes.ts`) rather than re-aggregated under a separate Tag.
export const HostRuntimeObservationSubstrateLive = PerContextRuntimeAgentOutputAfterEventsLive.pipe(
  Layer.provideMerge(RuntimeContextStateStoreLive),
  Layer.provideMerge(SessionAgentOutputChannelLive),
  Layer.provideMerge(RuntimeAgentOutputEventsLayer),
  Layer.provideMerge(RuntimeControlPlaneRecorderLive),
  Layer.withSpan("firegrid.host.runtime_substrate.observation.layer", {
    kind: "internal",
  }),
)

// TFIND-031 (Option Y, execution-scoped): the workflow-body capture
// seam (`RuntimeContextWorkflowNativeLayer`) is built *inside*
// `runtimeContextWorkflowSupportLayer`, where
// `HostRuntimeObservationSubstrateLive` self-contains the observation
// substrate. Host-level seams (commands / agent-tool-host) capture only
// the public host runtime context; wait-store services are not ambient on
// `FiregridRuntimeHostWithWorkflowLive`.
//
// wait/child-output streams deletion: the previous
// `RuntimeContextWorkflowExecutionEnv` alias was a local re-export of
// `HostRuntimeContextExecutionEnv`. It became dead-code after removing
// `HostRuntimeObservationStreamsLive` (which no caller imports the alias
// any more). Use `HostRuntimeContextExecutionEnv` directly in any new
// composition seam.
