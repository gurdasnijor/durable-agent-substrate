import type { RuntimeEvent } from "@firegrid/protocol/launch"
import type {
  MaterializerProjectResult,
  RuntimeOutputMaterializer,
} from "./types.ts"

type ExampleAssistantEvent = {
  readonly type: "assistant"
  readonly text: string
}

const isExampleAssistantEvent = (
  value: unknown,
): value is ExampleAssistantEvent =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "assistant" &&
  "text" in value &&
  typeof value.text === "string"

const decodeExampleAssistantEvent = (
  row: RuntimeEvent,
): MaterializerProjectResult | ExampleAssistantEvent => {
  try {
    const value: unknown = JSON.parse(row.raw)
    return isExampleAssistantEvent(value)
      ? value
      : { changes: [], failures: [] }
  } catch (cause) {
    return {
      changes: [],
      failures: [
        {
          sourceRuntimeEventId: row.eventId,
          reason: "malformed-json",
          cause,
        },
      ],
    }
  }
}

export const exampleJsonlSessionMaterializer: RuntimeOutputMaterializer = {
  name: "example-jsonl-session",
  version: "0",
  project: row => {
    const event = decodeExampleAssistantEvent(row)
    if ("changes" in event) return event

    const sessionId = `session_${row.contextId}`
    return {
      failures: [],
      changes: [
        {
          kind: "upsertSession",
          value: {
            sessionId,
            contextId: row.contextId,
            status: "active",
          },
        },
        {
          kind: "upsertMessage",
          value: {
            messageId: `msg_${row.contextId}_${row.activityAttempt}_${row.sequence}`,
            sessionId,
            contextId: row.contextId,
            role: "assistant",
            text: event.text,
            sourceRuntimeEventId: row.eventId,
            createdAt: row.receivedAt,
          },
        },
      ],
    }
  },
}
