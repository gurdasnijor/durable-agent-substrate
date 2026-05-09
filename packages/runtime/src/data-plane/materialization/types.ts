import type {
  RuntimeEvent,
  RuntimeOutputCursor,
} from "@firegrid/protocol/launch"
import type {
  MessageProjection,
  SessionProjection,
} from "@firegrid/protocol/session"

export type MaterializerFailure = {
  readonly sourceRuntimeEventId: string
  readonly reason: string
  readonly cause?: unknown
}

export type MaterializerChange =
  | {
    readonly kind: "upsertSession"
    readonly value: SessionProjection
  }
  | {
    readonly kind: "upsertMessage"
    readonly value: MessageProjection
  }

export type MaterializerProjectResult = {
  readonly changes: ReadonlyArray<MaterializerChange>
  readonly failures: ReadonlyArray<MaterializerFailure>
}

export type RuntimeOutputMaterializer = {
  readonly name: string
  readonly version: string
  readonly project: (
    row: RuntimeEvent,
  ) => MaterializerProjectResult
}

export type MaterializerSummary = {
  readonly rowsRead: number
  readonly rowsProjected: number
  readonly rowsSkipped: number
  readonly rowsFailed: number
  readonly changesEmitted: number
  readonly failures: ReadonlyArray<MaterializerFailure>
}

export interface MaterializeRuntimeOutputToSessionOptions {
  readonly sourceDataPlaneStreamUrl: string
  readonly targetSessionStreamUrl: string
  readonly contextId: string
  readonly materializer: RuntimeOutputMaterializer
  readonly since?: RuntimeOutputCursor
}
