import {
  startDurableStreamsTestServer,
  type DurableStreamsTestServerHandle,
} from "@firegrid/durable-streams/test-utils"
import {
  FiregridRuntimeHostLive,
  getHostRequiredAction,
  hostRequiredActionRows,
  resolveHostRequiredAction,
  startHostRequiredAction,
} from "@firegrid/runtime"
import { Duration, Effect, Fiber } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let server: DurableStreamsTestServerHandle | undefined

beforeEach(async () => {
  server = await startDurableStreamsTestServer()
})

afterEach(async () => {
  await server?.stop()
  server = undefined
})

const createStreamUrl = async (name: string): Promise<string> => {
  if (!server) throw new Error("server not started")
  return server.createStreamUrl(name)
}

describe("firegrid tracer 009 required actions", () => {
  it("firegrid-required-actions.RECORDS.1 firegrid-required-actions.RECORDS.2 firegrid-required-actions.RECORDS.3 firegrid-required-actions.RECORDS.4 firegrid-required-actions.WORKFLOW.1 firegrid-required-actions.WORKFLOW.2 firegrid-required-actions.WORKFLOW.3 firegrid-required-actions.WORKFLOW.4 firegrid-required-actions.WORKFLOW.5 firegrid-required-actions.BOUNDARY.1 firegrid-required-actions.BOUNDARY.2 firegrid-required-actions.BOUNDARY.3 firegrid-required-actions.BOUNDARY.4 firegrid-required-actions.BOUNDARY.5 firegrid-architecture-boundary.SURFACE_AREA.6 proves required actions unblock through host-owned durable workflow state", async () => {
    const requiredActionStreamUrl = await createStreamUrl("tracer-009-required-action")
    const workflowStreamUrl = await createStreamUrl("tracer-009-workflow")
    const controlPlaneStreamUrl = await createStreamUrl("tracer-009-control-plane")
    const runtimeOutputStreamUrl = await createStreamUrl("tracer-009-runtime-output")
    const requiredActionId = `req_${crypto.randomUUID()}`

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(startHostRequiredAction({
          requiredActionId,
          runtimeContextId: "ctx_tracer_009",
          requestKind: "approval",
          subject: {
            kind: "opaque-runtime-event",
            eventId: "runtime-output-1",
          },
          prompt: {
            text: "Approve the opaque runtime action?",
          },
          options: [
            { id: "approve", label: "Approve" },
            { id: "deny", label: "Deny" },
          ],
        }))

        let state = yield* getHostRequiredAction(requiredActionId)
        while (state.request === undefined) {
          yield* Effect.sleep(Duration.millis(5))
          state = yield* getHostRequiredAction(requiredActionId)
        }

        yield* resolveHostRequiredAction({
          requiredActionId,
          outcome: "approved",
          resolvedBy: "scenario:tracer-009",
          selectedOptionId: "approve",
          resolvedAt: "2026-05-09T00:00:00.000Z",
        })

        const decision = yield* Fiber.join(fiber)
        const duplicate = yield* resolveHostRequiredAction({
          requiredActionId,
          outcome: "approved",
          resolvedBy: "scenario:tracer-009",
          selectedOptionId: "approve",
          resolvedAt: "2026-05-09T00:00:00.000Z",
        })
        const conflict = yield* resolveHostRequiredAction({
          requiredActionId,
          outcome: "denied",
          resolvedBy: "scenario:tracer-009",
          selectedOptionId: "deny",
          resolvedAt: "2026-05-09T00:00:01.000Z",
        })

        return {
          decision,
          duplicate,
          conflict,
          state: yield* getHostRequiredAction(requiredActionId),
          rows: yield* hostRequiredActionRows,
        }
      }).pipe(
        Effect.provide(FiregridRuntimeHostLive({
          streams: {
            workflow: workflowStreamUrl,
            controlPlane: controlPlaneStreamUrl,
            runtimeOutput: runtimeOutputStreamUrl,
            requiredActions: requiredActionStreamUrl,
          },
          workerId: "tracer-009-worker",
        })),
      ),
    )

    expect(result.decision).toMatchObject({
      requiredActionId,
      outcome: "approved",
      resolvedBy: "scenario:tracer-009",
      selectedOptionId: "approve",
    })
    expect(result.duplicate).toEqual(result.decision)
    expect(result.conflict).toEqual(result.decision)
    expect(result.state.status).toBe("approved")
    expect(result.state.request).toMatchObject({
      requiredActionId,
      runtimeContextId: "ctx_tracer_009",
      requestKind: "approval",
    })
    expect(result.state.resolution).toEqual(result.decision)
    expect(result.rows.map(row => row.type)).toEqual([
      "firegrid.required_action.requested",
      "firegrid.required_action.resolved",
    ])
    expect(result.rows.filter(row => row.type === "firegrid.required_action.resolved")).toHaveLength(1)
  })
})
