# `unified/` — unified subscriber kernel

The signal-based subscriber architecture that replaced the former Shape C
`subscribers/` + `composition/` tiers (see
[`docs/sdds/SDD_FIREGRID_PROTOCOL_RESPONSE_UNIFICATION.md`](../../../../docs/sdds/SDD_FIREGRID_PROTOCOL_RESPONSE_UNIFICATION.md)
and [`docs/sdds/SDD_FIREGRID_UNIFIED_PRODUCTION_WIRING.md`](../../../../docs/sdds/SDD_FIREGRID_UNIFIED_PRODUCTION_WIRING.md)).

## What it owns

- `signal.ts` — the durable `signal` primitive (`sendSignal` / `awaitSignal`
  / `readSignalsFor` / `recordSignal` / `recoverPendingSignals`): the
  wake-with-payload capability the workflow engine doesn't ship natively.
- `subscribers/` — signal-based subscriber workflow bodies: the session
  lifecycle workflow (`runtime-context.ts`), the permission-roundtrip and
  tool-dispatch workflows (`permission-and-tool.ts`), and the
  scheduled-prompt / webhook / peer observers (`scheduled-webhook-peer.ts`).
- `tables.ts` — the `UnifiedTable` row families the engine does not already
  track (permissions, schedules, webhook facts, peer events).
- `adapter.ts` / `codec-adapter.ts` — the `RuntimeContextSessionAdapter` Tag
  and its production codec-backed Live (`ProductionCodecAdapterLive`).
- `channel-bindings.ts` — channel `Context.Tag` Live bindings backed by the
  signal primitive.
- `observers.ts` — `JournalObserverLive`, the daemon that turns journal rows
  into sibling-workflow executions.
- `host.ts` — `FiregridHost`, the one-call production composition factory.

## Import direction

`unified/` is a Shape D tier: it may import `engine/` (workflow machinery),
`events/`, `tables/`, `channels/`, `sources/`, and `@effect/workflow`. It is
the load-bearing subscriber + composition surface; lower pipeline tiers
(`events/`, `tables/`, `transforms/`) must not import it.

## Must not

- Re-introduce a generic "wait for any fact" workflow (string-dispatch over a
  fact-table name rebuilds the retired `SourceCollections` registry).
- Add `inputIntents` / `startRequests` / lifecycle-status row families — those
  collapse into signals + engine `executions.finalResult`.

**DO**: a subscriber body parks on `awaitSignal` / `readSignalsFor` and a
producer delivers via `sendSignal`.

**DO NOT**: spawn a per-input workflow or poll a table for new input rows.
