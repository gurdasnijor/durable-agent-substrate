# SDD: Flamecast On Direct Durable Streams State

Status: draft for iteration
Scope: `apps/flamecast` rebuild after the stream-first reset
Spec: `flamecast-direct-durable-state.feature.yaml`

## Context

PR #124 removed the old Firegrid substrate/client/runtime layers. That reset leaves Flamecast free to start from the actual primitives we trust:

- `@durable-streams/state` for durable collections and actions.
- Effect Schema for persisted row and wire-event validation.
- Effect `Stream` for observation and processor composition where the app needs streaming control flow.
- App-owned provider adapters for the agent execution surface.

The important constraint is negative: do not recreate Firegrid-specific handlers, `ctx`, `RunWait`, `PlaneProducer`, event-plane facades, operation lifecycles, or package entrypoints before a real Flamecast implementation proves a repeated shape.

## Source Inputs

This draft uses:

- `docs/prds/PRD_FLAMECAST.md`
- `/Users/gnijor/smithery/flamecast-agents/src/db/schema.ts`
- `/Users/gnijor/smithery/flamecast-agents/src/effect/schemas.ts`
- `/Users/gnijor/smithery/flamecast-agents/src/events.ts`
- `/Users/gnijor/smithery/flamecast-agents/src/session.ts`

The live product vocabulary is stable enough to model now:

- `AgentMeta`, `AgentSpec`, `SkillBundle`, `McpsConfig`
- `SessionState`, `CreateSessionBody`, `SendMessageBody`
- `IngestEvent`, `EventRow`, `EventsResponse`
- provider selection: `claude-code`, `think`, `effectctx`
- machine/workspace selection: `cloudflare`, `sprites`, `modal`, `firebox`, legacy workspace layouts

The PRD adds the product contract this state model must satisfy:

- sessions are the public noun for starting, steering, observing, cancelling, and deleting agent work;
- agent providers are swappable execution backends selected by `AgentSpec`;
- capabilities describe desired behavior and must be checked before execution;
- provider-to-Flamecast delivery is callback-first, with callbacks normalized into the same public event history;
- Flamecast exposes the same session and event shape regardless of provider.

## Target Shape

The first Flamecast slice should be an app, not a framework integration. Its source shape should look roughly like:

```ts
// apps/flamecast/src/shared/state.ts
import { createStateSchema } from "@durable-streams/state"
import { Schema } from "effect"

export const FlamecastSession = Schema.Struct({
  sessionId: Schema.UUID,
  agent: AgentName,
  machine: Machine,
  workspace: WorkspaceLayout,
  status: SessionStatus,
  model: Schema.optional(Schema.String),
  lastMessage: Schema.optional(Schema.String),
  lastTurnAt: Schema.optional(Schema.String),
  turnCount: Schema.Number,
  error: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.UUID),
})

export const FlamecastEvent = Schema.Struct({
  eventId: Schema.String,
  sessionId: Schema.UUID,
  seq: Schema.Number,
  at: Schema.String,
  event: IngestEvent,
})

export const flamecastState = createStateSchema({
  sessions: {
    type: "flamecast.session",
    primaryKey: "sessionId",
    schema: Schema.standardSchemaV1(FlamecastSession),
  },
  events: {
    type: "flamecast.event",
    primaryKey: "eventId",
    schema: Schema.standardSchemaV1(FlamecastEvent),
  },
  agents: {
    type: "flamecast.agent",
    primaryKey: "id",
    schema: Schema.standardSchemaV1(FlamecastAgent),
  },
})
```

That is the model. No Firegrid descriptors. No operation descriptors. No substrate row envelope. Durable Streams State is already the durable row protocol.

## Durable Collections

Start with four collections only.

`agents`:
Reusable agent templates from the live `agents` table: `id`, `orgId`, `name`, `createdByWorkosUserId`, `archivedAt`, `createdAt`, `updatedAt`, plus an app-owned pointer to the R2/spec payload if needed. The first local app may skip org ownership, but the schema should not erase it.

`sessions`:
Mutable current state of a session. This replaces the DO `state` key and the old Postgres `sessions` row for the local app. It carries status, provider/runtime selection, machine/workspace, model, turn count, last message, error, callback metadata, and timestamps.

`events`:
Append-only normalized event rows keyed by `${sessionId}:${seq}` or a generated `eventId`, with `sessionId`, `seq`, `at`, `type`, indexed fields, and the full Effect Schema `IngestEvent`. This replaces DO SQLite event history for the local app. The UI derives transcript, tool tree, current turn, and timelines from this collection.

`turns`:
Optional but likely useful for processor ergonomics. A turn row is a work item: submitted/running/completed/failed/cancelled/input_required, tied to `sessionId`, `turnId`, `message`, and provider execution metadata. If event-derived processing is clean enough, skip this and let `turn_started` / `turn_complete` drive state.

`providerManifests`:
Provider metadata from the PRD: supported models, caller instructions, native capabilities, accepted contributors, steering, cancellation, permission support, event fidelity, provider-specific option schema, and provider auth requirements. This can start as static app data but should have the same shape the future `GET /providers` and `GET /providers/:id` APIs expose.

## Actions

Actions should be ordinary `createStreamDB({ actions })` actions.

`createSession(input)`:
Validate `CreateSessionBody`, resolve agent/machine/workspace compatibility, append the initial `sessions` row, and optionally append an initial user message plus submitted turn.

`sendMessage(input)`:
Validate `SendMessageBody`, reject incompatible session state, append a user event, mark the session `running`, increment turn count, and create a submitted turn boundary.

`ingestEvents(input)`:
Validate `IngestEvent[]`, append event rows with stable sequence numbers, and update `sessions` from terminal events. Provider adapters call this action; they do not mutate UI-specific state directly.

`cancelSession(input)`:
Append cancellation intent and update session state. Provider-specific abort mechanics stay in the adapter.

`checkProvider(input)`:
Validate `AgentSpec` against provider metadata before execution. This is the direct-state version of `POST /providers/:id/check`; it returns precise compatibility issues for unsupported model selection, instructions, capabilities, contributors, provider options, or provider auth.

## Runtime Processor

The local runtime is just app code over state:

```ts
const runFlamecastProcessor = (db: FlamecastDb) =>
  submittedTurns(db).pipe(
    Stream.mapEffect((turn) => runProviderTurn(db, turn), { concurrency: 1 }),
    Stream.runDrain,
  )
```

The processor owns:

- selecting the provider adapter from the session/agent state;
- invoking `think`, `claude-code`, or future provider runtimes;
- converting provider-specific updates into `IngestEvent`;
- calling `db.actions.ingestEvents(...)`;
- reflecting terminal events into the session row.

The processor does not need a Firegrid handler signature. Inputs are durable rows. Outputs are durable rows. Time, if needed, is Effect `Clock` inside the app processor, not a Firegrid wait API.

## Public API Mapping

The PRD HTTP API can sit directly on top of the state actions and collections:

| PRD route | Direct-state lowering |
| --- | --- |
| `GET /providers` | Read `providerManifests` static data or collection. |
| `GET /providers/:id` | Read one provider manifest. |
| `POST /providers/:id/check` | Run `checkProvider`. |
| `POST /sessions` | Run `createSession`. |
| `GET /sessions` | Query `sessions`. |
| `GET /sessions/:id` | Read one `sessions` row. |
| `POST /sessions/:id/events` | Run `sendMessage`, permission response, or steering action. |
| `GET /sessions/:id/events` | Query `events` by `sessionId` and `seq`. |
| `POST /sessions/:id/cancel` | Run `cancelSession`. |
| `DELETE /sessions/:id` | Mark deleted or archive the session row; preserve event history unless product policy says otherwise. |

No Firegrid runtime package is needed to provide these routes. A Remix, Hono, Worker, or Node HTTP layer can call the same state actions the browser and processor use.

## Provider Contract

Provider adapters should be app-owned modules implementing the PRD provider shape:

```ts
interface FlamecastProviderAdapter {
  readonly manifest: ProviderManifest
  readonly check: (input: AgentSpec) => Effect.Effect<CompatibilityResult, never>
  readonly createSession: (input: ProviderSessionCreate) => Effect.Effect<void, ProviderError>
  readonly sendEvent: (input: ProviderSessionEvent) => Effect.Effect<void, ProviderError>
  readonly cancel: (input: ProviderSessionCancel) => Effect.Effect<void, ProviderError>
}
```

Adapters do not mutate UI state. They produce provider callbacks or local callback-equivalent events, and Flamecast normalizes those into `IngestEvent` before durable append. That preserves the PRD rule that opaque providers may expose only coarse events while richer providers can expose tool calls, tool results, usage, and cost.

## Browser Client

The browser should use the same Durable Streams State schema:

```ts
const db = createStreamDB({
  streamOptions: { url: streamUrl, contentType: "application/json" },
  state: flamecastState,
  actions: flamecastActions,
})

await db.preload()
await db.actions.sendMessage({ sessionId, message })

db.collections.events.subscribeChanges(() => {
  renderTimeline(eventsForSession(db, sessionId))
})
```

The first version can use collection subscriptions directly. If this gets noisy, the first abstraction candidate is a tiny app-local hook like `useCollection(db.collections.events, selector)`, not a Firegrid client package.

## Why This Is Different From The Old Design

The old design started with Firegrid-owned operation abstractions and then tried to fit Flamecast into them. That made even a basic demo choose between handlers, contexts, subscribers, RunWait, EventPlane producers, and client facades.

This design starts from Flamecast's product state:

- sessions are rows;
- events are rows;
- turns are rows if useful;
- providers are app adapters;
- UI is a projection over rows;
- runtime work is an app-owned processor over rows.

The only reusable infrastructure we should extract later is whatever survives that implementation.

## Abstraction Opportunities

Do not build these first. Evaluate after Flamecast has the direct version working.

`defineStateApp(schema, actions)`:
Only if multiple apps repeat the same `createStreamDB` bootstrapping, preload, close, and action wiring.

Effect `Stream` collection adapters:
Useful if collection subscriptions repeatedly need scoped `Stream` wrappers. This should expose actual `Stream<A, E, R>`, not a custom subscription type.

Durable Clock layer:
Useful only where an app processor needs durable timer semantics behind `Effect.sleep`, `Schedule`, or time-aware `Stream` operators. The production artifact is the Clock substitution layer; demo stores and scenario harnesses are not public entrypoints.

Provider adapter interface:
Likely app/product-owned. It may become reusable only if Flamecast splits provider SDK work out of the UI app.

## Implementation Plan

1. Port live Effect Schema definitions into `apps/flamecast/src/shared/schema.ts`.
2. Define `flamecastState` with `sessions`, `events`, `agents`, and maybe `turns`.
3. Add provider manifest data and `checkProvider` compatibility validation for the first provider.
4. Implement direct `createStreamDB` actions for create session, send message, ingest events, and cancel.
5. Build a local processor over submitted turns using one deterministic provider first.
6. Add PRD route handlers as thin calls into state actions and collection queries.
7. Replace the current Flamecast UI reads with direct Durable Streams State reads and subscriptions.
8. Add one end-to-end local test that creates a session, sends a message, observes normalized events, and sees the session reach a terminal state.
9. Only then review repeated code and propose extraction candidates.

## Open Questions

1. Should `turns` be a first-class collection, or should `turn_started` / `turn_complete` events be the only turn source of truth?
2. Is local sequence allocation per session enough for the first slice, or do we need a stronger single-writer rule before multiple processors exist?
3. Which live provider should be the first non-deterministic adapter: `think` or `claude-code`?
4. Should callback delivery be an action-derived processor over session state changes, or an immediate side effect of terminal ingestion?
5. Do we need org ownership in the local Firegrid app immediately, or can the first integration keep it in schema but not enforce it?
6. Should provider manifests be static config in the first app build, or a Durable Streams State collection from day one?
