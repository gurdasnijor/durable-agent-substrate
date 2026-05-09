import {
  stream as readStream,
} from "@durable-streams/client"
import {
  compareRuntimeOutputOrder,
  isAfterRuntimeOutputCursor,
  RuntimeJournalEventSchema,
  type RuntimeEvent,
  type RuntimeJournalEvent,
} from "@firegrid/protocol/launch"
import { Effect, Schema } from "effect"
import {
  producerIdFor,
  StateProtocolProducer,
  toSessionStateEvent,
} from "./producer.ts"
import type {
  MaterializerFailure,
  MaterializerSummary,
  MaterializeRuntimeOutputToSessionOptions,
} from "./types.ts"

export class MaterializerRunnerError extends Schema.TaggedError<MaterializerRunnerError>()(
  "MaterializerRunnerError",
  {
    op: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export const readRuntimeJournal = (
  options: {
    readonly streamUrl: string
  },
): Effect.Effect<ReadonlyArray<RuntimeJournalEvent>, MaterializerRunnerError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await readStream<unknown>({
        url: options.streamUrl,
        offset: "-1",
        live: false,
        json: true,
      })
      const rows = await response.json()
      return rows.map(row => Schema.decodeUnknownSync(RuntimeJournalEventSchema)(row))
    },
    catch: cause => new MaterializerRunnerError({ op: "readRuntimeJournal", cause }),
  })

const stdoutRowsForContext = (
  journal: ReadonlyArray<RuntimeJournalEvent>,
  options: MaterializeRuntimeOutputToSessionOptions,
): ReadonlyArray<RuntimeEvent> =>
  journal
    .flatMap(event =>
      event.type === "firegrid.runtime.output.stdout" ? [event.event] : [])
    .filter(row => row.contextId === options.contextId)
    .filter(row => isAfterRuntimeOutputCursor(row, options.since))
    .sort(compareRuntimeOutputOrder)

export const materializeRuntimeOutputToSession = (
  options: MaterializeRuntimeOutputToSessionOptions,
) =>
  Effect.scoped(Effect.gen(function* () {
    const journal = yield* readRuntimeJournal({
      streamUrl: options.sourceDataPlaneStreamUrl,
    })
    const rows = stdoutRowsForContext(journal, options)

    const producerFactory = yield* StateProtocolProducer
    const producer = yield* producerFactory.open({
      streamUrl: options.targetSessionStreamUrl,
      producerId: producerIdFor(options.materializer, options.contextId),
    })

    let changesEmitted = 0
    let rowsProjected = 0
    let rowsSkipped = 0
    let rowsFailed = 0
    const failures: Array<MaterializerFailure> = []

    yield* Effect.forEach(rows, row => {
      const result = options.materializer.project(row)
      failures.push(...result.failures)
      if (result.failures.length > 0) {
        rowsFailed += 1
        return Effect.void
      }
      if (result.changes.length === 0) {
        rowsSkipped += 1
        return Effect.void
      }

      rowsProjected += 1
      return Effect.forEach(result.changes, change =>
        producer.append(toSessionStateEvent(change, options.materializer)).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              changesEmitted += 1
            })),
        ), { discard: true })
    }, { discard: true })

    yield* producer.flush

    return {
      rowsRead: rows.length,
      rowsProjected,
      rowsSkipped,
      rowsFailed,
      changesEmitted,
      failures,
    } satisfies MaterializerSummary
  }))
