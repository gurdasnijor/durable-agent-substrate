import {
  DurableDeferred,
  Workflow,
} from "@effect/workflow"
import type { WorkflowEngine } from "@effect/workflow/WorkflowEngine"
import { Duration, Effect, Exit } from "effect"
import {
  RequiredActions,
} from "./service.ts"
import {
  RequiredActionError,
  type RequiredActionRequest,
  RequiredActionRequestSchema,
  type RequiredActionResolution,
  RequiredActionResolutionSchema,
} from "./schema.ts"
import {
  RequiredActionResolutionDeferred,
  requiredActionWorkflowName,
} from "./deferred.ts"
import {
  requiredActionWorkflowExecutionId,
} from "./ids.ts"

export const RequiredActionWorkflow = Workflow.make({
  name: requiredActionWorkflowName,
  payload: RequiredActionRequestSchema,
  success: RequiredActionResolutionSchema,
  error: RequiredActionError,
  idempotencyKey: payload => payload.requiredActionId,
})

const runRequiredActionWorkflow = Effect.fn(function* runRequiredAction(payload: RequiredActionRequest) {
    const actions = yield* RequiredActions
    const token = payload.workflowDeferredToken ??
      (yield* DurableDeferred.token(RequiredActionResolutionDeferred))
    // firegrid-required-actions.WORKFLOW.1
    // firegrid-required-actions.WORKFLOW.7
    yield* actions.request({
      ...payload,
      workflowDeferredToken: token,
    })

    const state = yield* actions.get(payload.requiredActionId)
    if (state.resolution !== undefined) return state.resolution

    // firegrid-required-actions.WORKFLOW.2
    const decision = yield* DurableDeferred.await(RequiredActionResolutionDeferred)

    // firegrid-required-actions.WORKFLOW.3
    yield* actions.resolve(decision)

    return decision
})

export const RequiredActionWorkflowLayer = RequiredActionWorkflow.toLayer(
  runRequiredActionWorkflow,
)

export const startRequiredAction = (
  request: RequiredActionRequest,
): Effect.Effect<RequiredActionResolution, RequiredActionError, WorkflowEngine> =>
  // firegrid-required-actions.BOUNDARY.1
  // firegrid-required-actions.BOUNDARY.2
  // firegrid-required-actions.BOUNDARY.3
  // firegrid-required-actions.BOUNDARY.4
  Effect.scoped(
    RequiredActionWorkflow.execute(request),
  )

export const awaitRequiredActionWorkflow = (
  requiredActionId: string,
): Effect.Effect<RequiredActionResolution, RequiredActionError, WorkflowEngine> =>
  RequiredActionWorkflow.poll(requiredActionWorkflowExecutionId(requiredActionId)).pipe(
    Effect.flatMap(result => {
      if (result?._tag === "Complete") {
        return Exit.matchEffect(result.exit, {
          onFailure: cause => Effect.failCause(cause),
          onSuccess: Effect.succeed,
        })
      }
      return Effect.sleep(Duration.millis(10)).pipe(
        Effect.flatMap(() => awaitRequiredActionWorkflow(requiredActionId)),
      )
    }),
  )
