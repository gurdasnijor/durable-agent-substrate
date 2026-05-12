export const requiredActionRequestedRowId = (
  requiredActionId: string,
): string =>
  `required-action:${requiredActionId}:requested`

export const requiredActionResolvedRowId = (
  requiredActionId: string,
): string =>
  `required-action:${requiredActionId}:resolved`

export const requiredActionWorkflowExecutionId = (
  requiredActionId: string,
): string =>
  `firegrid.required-action:${requiredActionId}`
