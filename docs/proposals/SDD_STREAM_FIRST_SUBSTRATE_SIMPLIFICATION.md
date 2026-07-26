# SDD: Stream-First Firegrid Substrate Simplification

Date: 2026-05-07

Status: Draft for review and dispatch

Proposed spec source of truth:
`features/firegrid/stream-first-substrate-simplification.feature.yaml`

## Purpose

Firegrid has accumulated substrate APIs that duplicate or partially shadow the
Durable Streams and Effect primitives now available to us:

- custom append helpers over Durable Streams State events;
- EventPlane producer/projection wrappers that expose row mechanics directly;
- projection/query and wait APIs that recreate parts of `Stream`;
- RunWait and choreography verbs that recreate parts of `Clock`, `Schedule`,
  `Effect.timeout`, and `Stream.takeUntil`;
- client examples that teach raw emit/read mechanics instead of durable state
  actions and stream-shaped observation.

The durable Clock PR made the direction concrete: once we used
`createStreamDB({ actions })`, State Protocol events, `awaitTxId`, and `close`,
the Firegrid-specific append plumbing immediately became suspect.

This SDD proposes a client/runtime-first simplification: **Firegrid goes all in
on Durable Streams State and Effect Stream/Clock, starting from
`@firegrid/client` and `@firegrid/runtime`.** Firegrid's value moves to
descriptors, public client ergonomics, runtime execution, Effect Layers, and
authority boundaries. `packages/substrate` is not a product surface to
preserve; it is a compatibility bucket to dismantle or privatize as client and
runtime replacements land.

## Core Decision

Firegrid is not a competing durable-state library, and `@firegrid/substrate`
is not the place users should start.

```txt
Durable Streams owns transport, retention, offsets, idempotent append,
long-polling, replay, and live follow.

Durable Streams State owns State Protocol events, typed StreamDB collections,
optimistic actions, transaction confirmation, and materialized state.

Effect owns Stream, Clock, Schedule, timeout, retry, sleep, resource scopes,
and dependency injection through Layers.

Firegrid owns typed descriptors, product/runtime authority boundaries,
client-facing ergonomics, and Node-tier runtime lowering over those primitives.
```

Any Firegrid API that exists only to rename one of those upstream primitives is
debt. Any Firegrid API that makes the upstream primitive harder to use is a
bug. Any `@firegrid/substrate` export that app code still needs for normal
work is suspect until proven otherwise.

## Prior Art And Inputs

Relevant upstream patterns:

- Durable Streams State StreamDB skill:
  `createStreamDB({ state, actions })`, `db.preload()`,
  `db.collections`, action `onMutate`, action `mutationFn`,
  `db.utils.awaitTxId(txid)`, and `db.close()`.
- Durable Streams State README: State Protocol insert/update/delete/upsert
  helpers are the message format. Firegrid should not create a parallel row
  envelope for ordinary durable state.
- Effect `Stream`: stream operators such as `map`, `tap`, `scan`,
  `mapEffect`, `take`, `takeUntil`, `timeout`, `debounce`, `throttle`, and
  schedule-backed constructors are the observation and processing vocabulary.
- Effect `Clock` and `TestClock`: time is substitutable through a Layer.
  Firegrid durable time should be a Clock implementation, not new wait/sleep
  verbs.

Relevant Firegrid evidence:

- PR #123 proved a durable Clock can be expressed as Effect `Clock` over a
  Durable Streams State `clockWakeups` collection.
- The API footgun inventory found that canonical examples still expose
  `Firegrid.subscribers.*`, direct `RunWait`, `PlaneProducer.emit`,
  materializer naming, raw projection handles, and browser substrate reads.
- The operation lifecycle spike found that client `call/result/observe` can
  be modeled as a lifecycle stream scanned into public state.
- The descriptor boundary spike found that browser-safe descriptors are viable
  and should be separated from runtime/substrate mechanics.

## Problem Statement

Building a basic Firegrid app has been too hard because users must choose
between too many substrate-shaped APIs:

- "Do I emit an EventStream event, write an EventPlane row, use a producer,
  call a projection, subscribe, wait, or run a client query?"
- "Do I use `RunWait.sleep`, durable Clock, Effect `sleep`, or a subscriber?"
- "Do I use `appendChange`, `DurableStream.append`, StreamDB actions, or a
  Firegrid producer?"
- "Do I read through projection-query, EventPlane projection, raw StreamDB,
  retained records, or client observe?"

That decision tree is not a documentation problem. It is API design debt.

The current substrate exposes implementation seams that should either be:

- internal runtime lowering, or
- deleted in favor of upstream primitives.

## Design Principles

### 1. StreamDB For Stateful Durable Data

Any Firegrid durable state collection should be modeled as a State Protocol
collection behind `createStreamDB`.

Writes that need confirmation use StreamDB actions:

```ts
const db = createStreamDB({
  streamOptions,
  state,
  actions: ({ db, stream }) => ({
    addThing: {
      onMutate: (thing) => {
        db.collections.things.insert(thing)
      },
      mutationFn: async (thing) => {
        const txid = crypto.randomUUID()
        await stream.append(
          JSON.stringify(state.things.insert({ value: thing, headers: { txid } })),
        )
        await db.utils.awaitTxId(txid)
      },
    },
  }),
})
```

Firegrid may generate these actions from descriptors, but the generated action
must still lower to this shape. Firegrid should not expose or document
`appendChange` as an application or runtime authoring path.

### 2. Effect Stream For Observation

Public Firegrid observation APIs return `Stream<A, E, R>` or expose a
StreamDB/live-query-native collection where appropriate.

Rejected public shapes:

- callback registration;
- `AsyncIterable` as the primary API;
- Firegrid-specific subscription objects;
- Firegrid wrappers named like existing Stream operators;
- snapshot-then-stream APIs that can race without a single durable follow
  boundary.

If a caller needs `takeUntil`, `scan`, `timeout`, `mapEffect`, `retry`, or
telemetry hooks, they use Effect Stream operators directly.

### 3. Effect Clock For Time

Firegrid durable time is an Effect `Clock` Layer.

Rejected public shapes:

- `ctx.wait.sleep`;
- `RunWait.sleep` as canonical app code;
- Firegrid-specific timeout/retry/schedule helpers;
- runtime handler examples that teach durable time through Firegrid verbs
  instead of `Effect.sleep`, `Effect.timeout`, `Schedule`, and Stream
  operators under Firegrid's Clock Layer.

Internal compatibility may keep RunWait while handlers migrate, but new
canonical examples must use Effect time.

### 4. Descriptors Are Meaning, Not Mechanics

Firegrid descriptors describe:

- operation names and schemas;
- event/state collection names and schemas;
- partition keys;
- authority and locality rules;
- runtime/client lowering targets.

Descriptors must not expose:

- raw stream URLs;
- raw Durable Streams State envelopes;
- client instances;
- runtime handlers;
- producer handles;
- claim or terminal authority.

### 5. Product Scenarios Must Exercise Client And Runtime

Scenarios that only append a toy event to a stream are not valid ergonomics
proofs.

Canonical scenarios must show a product-shaped flow:

```txt
client action
  -> StreamDB action or Firegrid client operation
  -> runtime processor/handler observes durable state
  -> runtime writes product state through generated StreamDB actions
  -> browser observes materialized durable state as a stream/live query
  -> restart/reconnect proves state is durable
```

LT-02 Flamecast is the target proof. Bare stream emitters are allowed only as
unit tests for lower-level libraries.

## Client/Runtime First Architecture

```txt
@firegrid/descriptors
  Browser-safe descriptor values:
  Operation, StateCollection, EventStream, RuntimeGraph, typed IDs.

@firegrid/client
  StreamDB-backed app client:
  generated actions, operation lifecycle streams, descriptor-scoped reads.

@firegrid/runtime
  Node-tier runtime:
  processors, handler registration, durable Clock Layer, Effect runtime
  integration, lifecycle publishing.

@firegrid/substrate
  Private compatibility and implementation detail while old surfaces are
  dismantled. Not a normal application import path.

@durable-streams/client
  Transport and stream append/read.

@durable-streams/state
  State Protocol, createStateSchema, createStreamDB, actions, awaitTxId,
  collections, materialized state.

effect
  Stream, Clock, Schedule, Effect, Scope, Layer.
```

The important simplification is not package renaming. It is that Firegrid
starts with the two surfaces users actually need:

- `@firegrid/client` for browser/server code that sends app actions,
  observes durable state, and reads operation lifecycle;
- `@firegrid/runtime` for Node-tier code that consumes durable state, runs
  processors/handlers, writes product state, installs durable Clock, and
  publishes lifecycle.

`@firegrid/substrate` should not be designed as a stable public layer. If a
piece of substrate survives, it survives as private runtime/client
implementation or as a tiny extracted package with a concrete reason to exist.

## Top-Down Traversal Method

The migration should proceed from the real runtime entrypoints downward, not
from substrate outward.

Start here:

```txt
packages/runtime/bin/firegrid.ts
packages/runtime/src/run.ts
```

Then descend only through imports that are reachable from those files:

```txt
bin/firegrid.ts
  -> packages/runtime/src/index.ts
  -> FiregridRuntimeBoot.attached
  -> RuntimeContext / FiregridRuntime service
  -> caller-supplied runtime Layer

run.ts
  -> FiregridRuntimeBoot.attached
  -> caller-supplied runtime Layer
```

At each imported module, ask:

1. Is this concept part of the desired `@firegrid/runtime` public surface?
2. If not, is it a private implementation detail needed by that surface?
3. If not, does Durable Streams State or Effect already provide it?
4. If yes, prune the whole branch or replace it with the upstream primitive.

The first traversal already identifies the current cut:

- `bin/firegrid.ts` is mostly clean. It attaches to an existing stream URL and
  does not launch a Firegrid-owned Durable Streams server.
- `run.ts` is mostly clean. It provides runtime boot and then runs forever.
- `boot.ts` is mostly clean. It resolves runtime identity and provides
  `RuntimeContext`.
- The outdated concepts start under `runtime-api.ts`,
  `internal/runner.ts`, and `internal/operation-handler.ts`.

Those files import substrate kernel concepts directly:

- subscriber scans;
- `ProjectionSnapshot`;
- `RunWait` context;
- `processReadyWorkItem`;
- `appendChange`;
- raw `DurableStream` construction;
- EventPlane/projection mechanics;
- durable.run state-machine helpers.

That is the branch to prune first. The question is not "how do we preserve
subscribers, RunWait, EventPlane, and operation-handler?" The question is:

```txt
What should the caller-supplied runtime Layer do if it consumes StreamDB
collections / Effect Streams and writes through generated actions?
```

Anything in the current tree that only exists to support the old answer should
be treated as removable.

## API Outcomes

### Required Additions

- `@firegrid/descriptors` package or subpath containing browser-safe
  descriptors only.
- Descriptor-to-StateSchema lowering for app state collections.
- Descriptor-generated StreamDB actions for app/runtime writes.
- Descriptor-scoped client read APIs that return Effect Streams or expose
  StreamDB collections for framework adapters.
- Operation lifecycle as a State Protocol collection/stream scanned into
  public operation state.
- Runtime processor API that consumes durable streams/state and writes through
  generated actions.
- Durable Clock Layer is the only canonical durable-time API.

### Required Deletions Or Deprecations

- `appendChange` as a public or canonical write path.
- Canonical examples using `new DurableStream(...).append(...)` for Firegrid
  state writes.
- Canonical examples using `PlaneProducer.emit(ChangeEvent)`.
- Browser/client examples importing `@firegrid/substrate/event-plane` or
  `@firegrid/substrate/kernel`.
- Firegrid-specific wait/sleep/timeout/retry/schedule verbs in new ergonomic
  examples.
- Projection facade APIs whose only job is to duplicate StreamDB preload/live
  follow or Effect Stream operators.
- Handler context or facade objects that carry broad capabilities.

### Compatibility Kept Temporarily

The following may remain as internal or deprecated compatibility while the new
surface lands:

- existing EventPlane implementation;
- RunWait and choreography service;
- current operation durable.run row family;
- Work claim/operator internals;
- projection rebuild helpers used by runtime internals;
- root exports needed by already-merged packages.

Compatibility APIs should not appear in new canonical examples.

## What Happens To `packages/substrate`

Today `packages/substrate` contains descriptors, protocol schemas, write APIs,
projection services, retained records, ready work, event planes, durable waits,
operators, subscribers, coordination, and now durable Clock.

The default outcome is not "a smaller substrate product." The default outcome
is that `packages/substrate` is dismantled behind client/runtime replacements.
Each existing concept must prove it is not a relic of Firegrid's earlier
shadow implementation.

Survival test:

1. Durable Streams State does not already provide it.
2. Effect does not already provide it.
3. It is Firegrid-specific authority or descriptor lowering, not just a
   renamed wrapper.
4. A concrete client/runtime scenario breaks without it.

Likely outcomes:

- `appendChange`: delete or keep private only until callers migrate.
- `PlaneProducer`: replace with StreamDB/generated actions.
- `EventPlane`: keep only descriptor semantics if useful; delete producer and
  projection machinery as public APIs.
- `Projection`: replace with StreamDB/live query and Effect Stream wherever
  possible.
- `RunWait.sleep`: replace canonical usage with durable Clock.
- `RunWait.waitFor`: replace if Effect Stream over durable state expresses the
  same semantics.
- `subscribers`: replace with runtime stream processors if no additional
  authority semantics remain.
- `durable.run`: replace or derive public lifecycle from State Protocol if the
  lifecycle stream can carry the needed authority.
- claim/lease/terminal-winner logic: keep only if Durable Streams producer
  semantics and State Protocol ordering cannot express the rule.

What remains after this test should be private implementation code under
client/runtime, not a broad package that product authors import.

## Major Design Choices

### Use StreamDB Actions Instead Of Firegrid Producers

For State Protocol collections, the write primitive is a StreamDB action with
confirmation. A Firegrid-generated producer can exist, but it is a typed action
facade over `createStreamDB`, not a separate append mechanism.

### Use Effect Streams Instead Of Firegrid Subscription Objects

Firegrid should return streams and let callers compose upstream operators.
Firegrid-specific subscription objects are allowed only at host boundaries
where a non-Effect runtime cannot consume a Stream directly.

### Use Durable Clock Instead Of RunWait For New Time Semantics

RunWait can remain for compatibility with current choreography, but the
canonical handler/runtime examples use `Effect.sleep`, `Effect.timeout`, and
`Schedule` under Firegrid's Clock Layer.

### Treat Operation Lifecycle As Durable State

Public lifecycle should be a State Protocol collection or stream:

```txt
Submitted | Completed | Failed | Cancelled
```

The public client scans this into:

```txt
Pending | Completed | Failed | Cancelled
```

Claimed/running/private runtime details stay internal.

### Keep Firegrid Runtime Authority

Going all in on streams does not mean browser code can author arbitrary runtime
terminal state. Generated actions must encode authority. Some collections are
client-authorable, some runtime-authorable, and some internal-only.

The authority boundary belongs to `@firegrid/client` and `@firegrid/runtime`.
It should not require product code to import substrate internals.

## Dispatchable Spike/PR Lanes

These are intentionally parallelizable for idle agents. Each lane should
produce either one research artifact or one narrow PR. Lanes should start from
client/runtime behavior and only inspect substrate to identify what can be
deleted or hidden.

### Lane 1: Client Surface Target

Artifact:
`docs/research/stream-first-client-target.md`

Tasks:

- Define the smallest `@firegrid/client` surface for LT-02:
  app actions, operation send/call/result/observe, and descriptor-scoped reads.
- Show canonical usage with `createStreamDB` actions and Effect Stream
  observation.
- Identify every substrate import that this client surface eliminates.

Acceptance:

- One complete client-side LT-02 before/after.
- No browser example imports `@firegrid/substrate`.

### Lane 2: Runtime Entry Traversal

Artifact:
`docs/research/stream-first-runtime-target.md`

Tasks:

- Start from `packages/runtime/bin/firegrid.ts` and
  `packages/runtime/src/run.ts`.
- Descend the reachable import tree until the first outdated concept appears.
- For each outdated branch, classify it as replace, privatize, or delete.
- Define the smallest replacement `@firegrid/runtime` surface for LT-02:
  processors/handlers, durable Clock installation, runtime-owned actions, and
  lifecycle publishing.
- Show how runtime code consumes StreamDB collections or Effect Streams instead
  of substrate subscribers/RunWait/EventPlane producers.

Acceptance:

- One complete runtime-side LT-02 before/after.
- A traversal map from `bin/firegrid.ts` / `run.ts` to the first pruned
  branches.
- No runtime example writes raw State Protocol envelopes directly.

### Lane 3: Descriptor Boundary

Artifact or PR:
`@firegrid/descriptors` package or documented subpath plan.

Tasks:

- Move or mirror browser-safe Operation and EventStream descriptors.
- Add StateCollection/StateGraph descriptor shape if needed.
- Prove no runtime/client/kernel imports are required.

Acceptance:

- Browser-safe package consumption test.
- No DurableStream, StreamDB, runtime, or kernel imports from descriptors.

### Lane 4: StreamDB Action Generator

Artifact or PR:
generated action helpers for one existing EventPlane descriptor.

Tasks:

- Lower one Firegrid state descriptor to `createStateSchema`.
- Generate StreamDB actions with `onMutate`, State Protocol event helpers,
  `txid`, `awaitTxId`, and `close`.
- Replace one existing `PlaneProducer.emit` example or test path.

Acceptance:

- No `appendChange` in the new path.
- Restart/reconnect test reads from the same stream URL.
- The API reads like product actions, not row appends.

### Lane 5: Operation Lifecycle Stream

Artifact or PR:
client-side lifecycle stream over State Protocol.

Tasks:

- Model Submitted/Completed/Failed/Cancelled lifecycle messages.
- Implement `client.observe` as stream scan.
- Implement `client.result` as stream terminal read.
- Keep internal durable.run if needed as compatibility.

Acceptance:

- Public state remains Pending/Completed/Failed/Cancelled.
- No RunWait/projection-until at the client surface.

### Lane 6: Projection Query Collapse

Artifact:
proposal patch to retire duplicate projection APIs.

Tasks:

- Compare current projection-query APIs to StreamDB preload/live and Effect
  Stream operators.
- Identify what remains Firegrid-specific: descriptor scoping, decode errors,
  auth, retention-gap reporting.
- Delete or deprecate wrapper operators that duplicate Stream.

Acceptance:

- Concrete before/after for LT-02 timeline read.
- No snapshot-then-stream race in the proposed path.

### Lane 7: Runtime Handler Shape

Artifact:
handler authoring SDD addendum.

Tasks:

- Decide what a handler authors: product state actions, returned output, or a
  stream processor.
- Remove broad `ctx` from proposed examples.
- Show one complete LT-02 before/after.

Acceptance:

- The "after" example is visibly simpler and does not wait on its own writes.
- Any remaining imperative writes are product actions, not row mechanics.

### Lane 8: Choreography And RunWait Migration

Artifact:
compatibility/migration note.

Tasks:

- Classify existing RunWait APIs as internal, deprecated, or still required.
- Map `sleep` and timeout semantics to durable Clock.
- Map projection wait semantics to Effect Stream composition.
- Identify runtime checkpoint gap if any.

Acceptance:

- New canonical examples contain no `RunWait.sleep`.
- Existing tests keep compatibility until a replacement lands.

## First Concrete PR Recommendation

Do not start by rewriting runtime execution.

Start by making the public client/runtime target real:

1. Add the stream-first simplification feature spec.
2. Add docs/examples for the intended `@firegrid/client` and
   `@firegrid/runtime` LT-02 paths.
3. Mark `@firegrid/substrate` as non-canonical for app examples.
4. Add a lint/architecture rule preventing new app/client/runtime examples from
   importing `appendChange` or using `new DurableStream(...).append(...)` for
   Firegrid state writes.
5. Convert one small state-writing path to a StreamDB action behind a
   client/runtime-facing helper.

That first PR creates the ratchet from the correct side of the API. Follow-up
lanes can then remove producer, projection, lifecycle, and wait debt without
reopening the design argument.

## Open Questions

1. Does Firegrid create a new `@firegrid/descriptors` package immediately, or
   use a browser-safe subpath first?
2. Do generated actions live in `@firegrid/client`, `@firegrid/runtime`, or a
   shared descriptor-derived helper package?
3. Which current EventPlane APIs are still valuable as descriptor syntax, and
   which are just producer/projection mechanics?
4. Does Durable Streams State provide enough conflict/claim semantics for
   runtime work ownership, or does `@firegrid/runtime` keep a private claim
   algorithm?
5. What is the minimal runtime checkpoint primitive needed after durable Clock
   wake-up dispatch?
6. Should operation lifecycle replace durable.run as substrate authority, or
   first ship as a public stream derived from existing internals?

## Review Bar

Reviewers should reject new Firegrid substrate APIs when:

- the same behavior is a direct `createStreamDB` action;
- the same observation is an Effect `Stream` operator composition;
- the same time behavior is Effect `Clock`, `Schedule`, `sleep`, or timeout;
- the API exposes row envelopes, stream URLs, claim IDs, completion IDs, or
  kernel imports to app/browser examples;
- the example is a bare stream emitter instead of a product-shaped client plus
  runtime scenario.

The default answer to new substrate surface area should be: start at
`@firegrid/client` or `@firegrid/runtime`; use Durable Streams State and Effect
directly underneath; add or preserve substrate code only when a client/runtime
scenario proves a Firegrid-owned gap.
