import { NodeContext } from "@effect/platform-node"
import {
  DurableStreamsWorkflowEngine,
  type WorkflowStateStoreError,
} from "@firegrid/durable-streams"
import { Context, Effect, Layer } from "effect"
import {
  RuntimeContextWorkflowLayer,
} from "../control-plane/runtime-context/workflow.ts"
import {
  RuntimeControlPlaneLive,
} from "../control-plane/runtime-context/service.ts"
import {
  startRuntimeContext,
  type StartRuntimeContextOptions,
  type StartRuntimeResult,
} from "../control-plane/runtime-context/launcher.ts"
import type {
  RuntimeContextError,
} from "../control-plane/runtime-context/errors.ts"
import {
  LocalProcessSandboxProvider,
} from "@firegrid/sandbox-local-process"
import {
  RuntimeCaptureJournalLive,
} from "../data-plane/runtime-output/writer.ts"
import {
  asRuntimeContextError,
} from "../control-plane/runtime-context/errors.ts"
import {
  RequiredActions,
  RequiredActionsLive,
} from "../required-action/service.ts"
import {
  startRequiredAction,
} from "../required-action/launcher.ts"
import type {
  RequiredActionError,
  RequiredActionRequest,
  RequiredActionResolution,
  RequiredActionResolveRequest,
  RequiredActionRow,
  RequiredActionState,
} from "../required-action/schema.ts"

export interface RuntimeHostStreams {
  readonly workflow: string
  readonly controlPlane: string
  readonly runtimeOutput: string
  readonly requiredActions: string
}

export interface RuntimeHostOptions {
  readonly streams: RuntimeHostStreams
  readonly workerId?: string
}

export type StartRuntimeOptions = StartRuntimeContextOptions

interface FiregridRuntimeHostService {
  readonly start: (
    options: StartRuntimeOptions,
  ) => Effect.Effect<StartRuntimeResult, RuntimeContextError>
  readonly startRequiredAction: (
    request: RequiredActionRequest,
  ) => Effect.Effect<RequiredActionResolution, RequiredActionError | WorkflowStateStoreError>
  readonly resolveRequiredAction: (
    resolution: RequiredActionResolveRequest,
  ) => Effect.Effect<RequiredActionResolution, RequiredActionError | WorkflowStateStoreError>
  readonly getRequiredAction: (
    requiredActionId: string,
  ) => Effect.Effect<RequiredActionState, RequiredActionError | WorkflowStateStoreError>
  readonly requiredActionRows: Effect.Effect<
    ReadonlyArray<RequiredActionRow>,
    RequiredActionError | WorkflowStateStoreError
  >
}

export class FiregridRuntimeHost extends Context.Tag("firegrid/runtime/FiregridRuntimeHost")<
  FiregridRuntimeHost,
  FiregridRuntimeHostService
>() {}

const runtimeContextLayer = (
  options: RuntimeHostOptions,
) =>
  // firegrid-durable-launch-runtime-operator.RUNTIME_HOST.1
  // firegrid-durable-launch-runtime-operator.RUNTIME_HOST.2
  RuntimeContextWorkflowLayer.pipe(
    Layer.provideMerge(DurableStreamsWorkflowEngine.layer({
      streamUrl: options.streams.workflow,
      ...(options.workerId === undefined ? {} : { workerId: options.workerId }),
    })),
    Layer.provide(RuntimeControlPlaneLive({
      streamUrl: options.streams.controlPlane,
    })),
    Layer.provide(RuntimeCaptureJournalLive({
      streamUrl: options.streams.runtimeOutput,
    })),
    Layer.provide(LocalProcessSandboxProvider.layer()),
    Layer.provide(NodeContext.layer),
  )

const requiredActionLayer = (
  options: RuntimeHostOptions,
) =>
  Layer.mergeAll(
    RequiredActionsLive({
      streamUrl: options.streams.requiredActions,
    }),
    DurableStreamsWorkflowEngine.layer({
      streamUrl: options.streams.workflow,
      ...(options.workerId === undefined ? {} : { workerId: options.workerId }),
    }),
  )

export const FiregridRuntimeHostLive = (
  options: RuntimeHostOptions,
) =>
  Layer.succeed(
    FiregridRuntimeHost,
    FiregridRuntimeHost.of({
      start: request =>
        startRuntimeContext(request).pipe(
          Effect.provide(runtimeContextLayer(options)),
          Effect.catchTags({
            RuntimeControlPlaneError: cause =>
              Effect.fail(asRuntimeContextError(
                `runtime-control-plane.${cause.op}`,
                "failed to initialize runtime control plane",
                request.contextId,
                cause,
              )),
            WorkflowStateStoreError: cause =>
              Effect.fail(asRuntimeContextError(
                `workflow-state.${cause.op}`,
                "failed to run runtime context workflow state",
                request.contextId,
                cause,
              )),
          }),
        ),
      startRequiredAction: request =>
        // firegrid-required-actions.BOUNDARY.5
        // firegrid-architecture-boundary.SURFACE_AREA.6
        startRequiredAction(request).pipe(
          Effect.provide(requiredActionLayer(options)),
        ),
      resolveRequiredAction: resolution =>
        RequiredActions.pipe(
          Effect.flatMap(actions => actions.resolve(resolution)),
          Effect.provide(requiredActionLayer(options)),
        ),
      getRequiredAction: requiredActionId =>
        RequiredActions.pipe(
          Effect.flatMap(actions => actions.get(requiredActionId)),
          Effect.provide(requiredActionLayer(options)),
        ),
      requiredActionRows: RequiredActions.pipe(
        Effect.flatMap(actions => actions.rows),
        Effect.provide(requiredActionLayer(options)),
      ),
    }),
  )

export const startRuntime = (
  options: StartRuntimeOptions,
): Effect.Effect<StartRuntimeResult, RuntimeContextError, FiregridRuntimeHost> =>
  // firegrid-durable-launch-runtime-operator.RUNTIME_HOST.3
  FiregridRuntimeHost.pipe(
    Effect.flatMap(host => host.start(options)),
  )

export const startHostRequiredAction = (
  request: RequiredActionRequest,
): Effect.Effect<
  RequiredActionResolution,
  RequiredActionError | WorkflowStateStoreError,
  FiregridRuntimeHost
> =>
  FiregridRuntimeHost.pipe(
    Effect.flatMap(host => host.startRequiredAction(request)),
  )

export const resolveHostRequiredAction = (
  resolution: RequiredActionResolveRequest,
): Effect.Effect<
  RequiredActionResolution,
  RequiredActionError | WorkflowStateStoreError,
  FiregridRuntimeHost
> =>
  FiregridRuntimeHost.pipe(
    Effect.flatMap(host => host.resolveRequiredAction(resolution)),
  )

export const getHostRequiredAction = (
  requiredActionId: string,
): Effect.Effect<
  RequiredActionState,
  RequiredActionError | WorkflowStateStoreError,
  FiregridRuntimeHost
> =>
  FiregridRuntimeHost.pipe(
    Effect.flatMap(host => host.getRequiredAction(requiredActionId)),
  )

export const hostRequiredActionRows:
  Effect.Effect<
    ReadonlyArray<RequiredActionRow>,
    RequiredActionError | WorkflowStateStoreError,
    FiregridRuntimeHost
  > =
    FiregridRuntimeHost.pipe(
      Effect.flatMap(host => host.requiredActionRows),
    )
