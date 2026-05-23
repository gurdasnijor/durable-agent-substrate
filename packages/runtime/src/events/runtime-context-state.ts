// Pure RuntimeContext loop-state vocabulary.
//
// Logical pipeline position: events/ (the first layer of the pipeline). Pure:
// no Effect, no Layer, no Context.Tag, no DurableTable, no I/O. The schemas
// here describe the durable state row, NOT how it is stored — the storage
// authority lives in `workflow-engine/runtime-context-state.ts` (and will move
// to `tables/runtime-context-state.ts` in the target tree).
//
// This module exists so `transforms/runtime-context-transition.ts` can build
// its result schema without importing the storage authority (which would pull
// in `Effect`, `Layer`, and `DurableTable`). It is the minimal events/ slice
// the Shape C cutover transforms-move lane needs to stay pure.

import { Schema } from "effect"
import { RuntimeIngressInputRowSchema } from "@firegrid/protocol/runtime-ingress"
import { AgentInputEventSchema } from "../agent-event-pipeline/events/index.ts"

// Process-exit evidence — recorded on a `Terminated` transition. Internal to
// this module: callers receive it through `RuntimeContextEventState.exitEvidence`,
// or through the workflow-engine `RuntimeExitEvidence` re-export at the
// workflow-engine surface. Defined here (rather than imported) so events/ has
// no dependency on the workflow-engine module.
const RuntimeExitEvidenceSchema = Schema.Struct({
  exitCode: Schema.Number,
  signal: Schema.optional(Schema.String),
})

const PendingPermissionResponseSchema = Schema.Struct({
  permissionRequestId: Schema.String,
  row: RuntimeIngressInputRowSchema,
  event: AgentInputEventSchema,
})
export type PendingPermissionResponse = Schema.Schema.Type<typeof PendingPermissionResponseSchema>

export const RuntimeContextEventStateSchema = Schema.Struct({
  lastProcessedInputSequence: Schema.Number,
  lastProcessedOutputSequence: Schema.Number,
  pendingPermissionRequests: Schema.Array(Schema.String),
  pendingPermissionResponses: Schema.Array(PendingPermissionResponseSchema),
  exitEvidence: Schema.optional(RuntimeExitEvidenceSchema),
})
export type RuntimeContextEventState = Schema.Schema.Type<typeof RuntimeContextEventStateSchema>

export const initialRuntimeContextEventState: RuntimeContextEventState = {
  lastProcessedInputSequence: -1,
  lastProcessedOutputSequence: -1,
  pendingPermissionRequests: [],
  pendingPermissionResponses: [],
}
