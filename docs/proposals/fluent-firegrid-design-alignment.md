# fluent-firegrid — Design

Effect-native durable steps over Durable Streams.

This is the companion to restate-fluent's `DESIGN.md`, re-derived for the
substrate fluent-firegrid actually sits on: Effect-TS as the execution engine
and the Durable Streams journal as the durability layer, in place of Restate's
runtime and a hand-written generator scheduler. Sections §1–§2 establish the
architecture; §3–§4 introduce the one new primitive and show it in use; §5–§11
are the precise semantics; §12 is where the substrate is under-used today.

---

## 1. Architecture: two providers, three roles

The fluent stack is two packages. **fluent-firegrid** is the process-free *authoring*
surface — `run`, the durable primitives (`sleep` / `awaitEvent` / `invoke`), and
combinators, all written against a `Journal` interface; on its own it is a thin seam
over state and computation. **fluent-runtime** is the *host*: it provides that
`Journal` over Durable Streams, executes handlers, and operates the coordination
runtime on the async path. Together they span two providers — Durable Streams and
Effect — across three roles: **state** (what happened), **coordination** (who runs
next, and when), and **computation** (running the body). Durable Streams covers state
and the durable half of coordination; Effect covers computation and the client-side
half. Only the clock edge — a timer firing at T — belongs to neither, and that you
supply.

```
  STATE                      COORDINATION                       COMPUTATION
  (what happened)            (who runs next, when —             (running the body)
                              at-least-once, fenced)
  ┌─────────────────┐        ┌──────────────────────┐          ┌──────────────────┐
  │ Durable Streams  │        │ Durable Streams        │        │ Effect            │
  │  LOG             │        │  SUBSCRIPTIONS         │        │  fibers · scopes  │
  │  append·catch-up │        │  pull-wake·fence·lease │        │  all/race/fork    │
  │  tail·offset     │        ├──────────────────────┤        │  interrupt+finlzr │
  │  close·fork·TTL  │        │ Effect (client side):  │        │  Schema·Clock·    │
  │                  │        │  redrive pool ·        │        │  Layer            │
  │                  │        │  resolve-or-suspend ·  │        │                   │
  │                  │        │  execute               │        │                   │
  │                  │        ├──────────────────────┤        │                   │
  │                  │        │ your code: alarm/clock │        │                   │
  └────────┬────────┘        └──────────┬───────────┘        └────────┬─────────┘
           └─────────────────────────────┼───────────────────────────┘
                          ┌──────────────▼──────────────┐
                          │ fluent-firegrid — authoring  │  process-free
                          │ run · keyed replay ──────────┼ STATE × COMPUTATION → thin seam
                          │ primitives + combinators,    │  (the sleep/await/invoke
                          │ all typed vs Journal         │   surface, defined here)
                          └──────────────┬──────────────┘
                          ┌──────────────▼──────────────┐
                          │ fluent-runtime — host        │  the process; imports firegrid
                          │ provides Journal over DS ────┼ STATE × COORDINATION → a runtime
                          │ execute · redrive pool ·     │   it operates
                          │ alarm · onWake · claim/ack   │
                          └──────────────┬──────────────┘
                          ┌──────────────▼──────────────┐
                          │ handlers (Effect.gen + run)  │  authored vs firegrid,
                          │                              │  executed by the host
                          └──────────────────────────────┘
```

The split matters because the two paths differ in kind and fall on opposite sides of
the package boundary. `run` plus keyed replay is **state × computation** — record a
computation's outcome, skip it on replay — and that is *fluent-firegrid*, the
authoring surface; on its own it is a thin adapter. The §12 durable operations are
**state × coordination** — park, wake, resolve through the journal — and the part that
*operates* them is *fluent-runtime*, the host: the redrive worker pool, the alarm
source, and the resolve-or-suspend loop. fluent-firegrid only *defines* those
primitives, against the `Journal` interface; fluent-runtime provides the `Journal` and
runs the loop (the host→handlers arrow is execution, not dependency — fluent-firegrid
depends on neither). Both paths route through state, because the journal is the
universal resolution medium — every primitive resolves to one journal entry (§12). A
picture that calls the whole thing a "thin seam" hides the host.

**L0 — Durable Streams (state + the durable half of coordination).** An HTTP protocol for
append-only, offset-addressable, replayable byte streams. It does far more than
"a log": catch-up reads from any offset, live tailing over SSE/long-poll,
explicit closure as a durable EOF signal, copy-free forking, sliding TTL, and a
reserved subscription plane that wakes workers (webhook or pull-wake) with
generation fencing and leases. Pure HTTP, CDN-friendly, language-agnostic.

**Effect (computation + the client half of coordination).** The runtime that drives computation: fibers,
structured concurrency (`all` / `race` / `fork` / `forkScoped`), interruption
that runs finalizers, scopes for resource lifetime, `Deferred` for suspension,
`Layer`/`Context` for dependency injection, `Schema` for typed encode/decode,
and `Clock`/`Random` as swappable services. This is everything restate-fluent
had to hand-build as a scheduler — and, because the redrive pool,
`resolve-or-suspend`, and `execute` are themselves Effect, the client side of
coordination too.

**L1 — effect-durable-streams.** The Effect-native binding over L0: reads are
`Stream`, writes are `Effect`s (or a `Sink` producer), `Schema` sits at the
wire boundary, and protocol failures surface as typed errors (`Conflict`,
`Gone`, `StaleEpoch`, `SequenceGap`, …) rather than thrown HTTP. It binds the
*log* operations today; whether the coordination operations (claim / ack /
wake-tail) get the same L1 binding or L3 calls them directly is still open.

**fluent-firegrid (authoring).** The durable-execution *surface*: `run` (a durable
named step over the journal), keyed replay, the durable primitives (`sleep` /
`awaitEvent` / `invoke`), and combinators — all typed against a `Journal` interface
and ordinary Effect. Process-free; imported by handlers and by the host. It does not
open streams, hold leases, or run workers.

**fluent-runtime (host).** The process that makes the surface durable: it provides
the `Journal` `Layer` over L0 (with journaled `Clock`/`Random`), executes handlers,
and — as §12 develops — operates the wiring of L0's subscription plane into durable
sleep, wait, and child sessions: the redrive worker pool, claim / ack, and the alarm
source.

**L4 — user handlers.** Plain `(input: I) => Effect<O, E, R>`, written with
`Effect.gen`, using `run` for the steps that must survive a crash and ordinary
Effect for everything else.

The thesis, in one line: restate-fluent builds a *concurrency* engine on top of
a runtime that already gives durability; fluent-firegrid does the inverse — it
takes Effect's *computation* as given and adds the other two roles, **state** and
**coordination**, over Durable Streams. So this document spends its length on the
journal and the wake/redrive plane, and treats concurrency, cancellation, and
scoping as solved.

---

## 2. How a workflow maps down the stack

Every workflow concept resolves into a concrete artifact at each layer. This
table is the spine of the design — read it as "what actually happens when you
write X."

| Workflow concept | L3 fluent-firegrid | L1 effect-durable-streams | L0 Durable Streams |
|---|---|---|---|
| A durable step's outcome | `run(name, eff)` records it | `append` a Schema-encoded `JournalEvent` | `POST` (boundary-preserved JSON message) |
| Replay after crash/resume | keyed lookup over collected events | `collect` (catch-up `Stream` → array) | `GET ?offset=-1` |
| Concurrency / branching | `Effect.all` / `race` (no journal I/O) | — | — |
| Determinism (time, RNG) | journaled `Clock`/`Random` layers | `append` of the recorded reading | `POST` |
| Invocation completed | terminal event, then close | `stream.close` | `POST Stream-Closed: true` (EOF) |
| Live progress / observe | tail the journal | `read({ live: "sse" })` → `Stream` | `GET ?live=sse` |
| Suspend → resume | park on a wake `Deferred` | `tail` a wake stream / subscription | pull-wake claim + ack (fenced) |
| Single-owner per attempt | bump producer epoch | `producer` Sink with epoch | `Producer-Epoch` fencing |

The mapping table that retires restate-fluent's two bespoke types follows from
the same exercise:

| restate-fluent | fluent-firegrid (Effect) | Notes |
|---|---|---|
| `Operation<T>` (lazy, one-shot) | `Effect<A, E, R>` | Lazy, re-runnable, each run independent. Exact match. |
| `Future<T>` (eager, memoized) | `Fiber<A, E>` | Eager handle; `Fiber.join` is idempotent. |
| `gen(() => function*)` factory | `Effect.gen(function*)` | The result *is* an `Effect`; running it builds a fresh generator. No factory wrapper, no reuse trap. |
| `ops.run(name, fn)` | `run(name, effect, opts?)` | The one thing we add. |
| `all`/`race`/`any`/`allSettled` | `Effect.all` / `race`·`raceAll` / `all({mode:"either"})` | Effect built-ins. |
| `spawn(op)` | `Effect.fork` / `forkScoped` / `forkDaemon` | Returns a real `Fiber`. |
| scheduler, current-fiber slot | Effect runtime + context | Deleted. |
| `onMainExit: abandon \| join` | `Scope` (forkScoped) vs detached (forkDaemon) | Subsumed compositionally; forkScoped runs finalizers, which "abandon" cannot. |
| cancellation fan-out + AbortController dance | Effect interruption (structured, finalizer-aware) | Deleted; richer. |

restate-fluent needed `Operation`/`Future` because Restate's two kinds of work
had no names in the SDK, and needed `gen` to take a factory to forbid reusing
an exhausted generator. Effect names both and cannot hit the reuse bug —
running an `Effect` constructs a fresh generator each time, so Effect *is* the
factory. There is therefore no new type to introduce. At most
`type Operation<A, E, R> = Effect.Effect<A, E, R>` survives as a
migration-comfort alias; the recommendation is to drop even that and let
handlers be plain `Effect`s.

### Orchestration vocabulary → fluent-firegrid

One altitude up from the API table: the concepts a workflow author thinks in,
and what each becomes here. The third column is the point — the Effect or
substrate primitive that already does the job — and is the failure mode this
library exists to prevent. Section pointers go to the precise semantics.

| Orchestration concept | fluent-firegrid | Use this, don't rebuild it |
|---|---|---|
| Activity / task / durable step | `run(name, eff, { value })` — journaled, replayed by key | A bespoke step wrapper, manual retry loops, `as A` casts |
| Workflow / process / handler | `(input) => Effect<O, E, R>` via `Effect.gen` | A scheduler, an `Operation`/`Future` type, a generator driver, `onMainExit` |
| Parallel / racing / fan-out | structured concurrency — `Effect.all({ concurrency })`, `race`, `fork`/`forkScoped` (§8) | A combinator engine, manual chunking, abandon/join lifetime flags |
| Retry policy | `Effect.retry(Schedule)` *inside* `run` (§11) | A retry counter in journal state, a try/catch loop, retry *around* `run` (replay busy-loops) |
| Saga / compensation | `Effect.onError` / `acquireRelease` with `run`-backed compensation (§11) | A compensation service, a manual rollback ledger |
| Timer / sleep | tiered: `Effect.sleep` (non-durable) → `run("wait", sleep)` (journaled) → durable timer (§11–§12) | `setTimeout`; a redrive engine — the wake/lease half is L0's `__ds` plane, only the alarm source is yours |
| Cron / scheduled trigger | a due-time append wakes the redrive worker (§12) — same machinery as a durable timer | External cron, `setInterval` |
| Signal — data in (event, human-in-loop) | in-process: park on `Deferred`/`Queue`; durable/external: a pull-wake subscription resolves it (§12) | Polling a state flag; a custom awakeable engine |
| Signal — cancel / stop | `Fiber.interrupt(fiber)` in-process; external cancel arrives as interruption at the next yield (§9) | A cooperative cancel-flag + poll; an AbortController fan-out |
| Child workflow / sub-process | in-process: `Effect.fork` (its `run` steps journal to the parent → durable via the parent journal); independent durable child: its own journal + a subscription waking the parent (§12) | HTTP-call-with-manual-retry; a child-session engine |
| Query / read progress mid-run | tail the journal — `read({ live: "sse" })` (§12) | A polling handler, a state-dump endpoint, a separate progress bus |
| Wait for another invocation's result | tail its journal for the terminal event; completion is the stream's close/EOF (§12) | State polling, a callback webhook |
| Idempotency / dedup / run-ID | the `stepKey` (step-level) + one journal stream per invocation ID + producer epoch for attempt fencing (§5, §10) | A seen-ID set, a dedup table |
| Workflow variables / scratch state | ordinary Effect values / `Ref` within the invocation | An external DB for workflow-scoped data |
| Durable entity state (users, carts) | **not this layer** — Firegrid's `DurableTable` (sibling) | Storing entity state in the execution journal; a hand-rolled in-stream KV |
| Worker / task queue | none — an invocation is an `Effect` run by `execute`; durable pickup is the pull-wake claim/ack/lease (§12) | Worker pools, polling loops, a task-queue library |
| GC of finished runs | sliding `Stream-TTL` on the journal (§12) | A cleanup sweeper/cron |
| Single-writer lock | one exclusive writer per journal stream + producer epoch fencing (§10) | An external lock service |

### What's different from a workflow orchestrator

- **No worker, no scheduler, no DSL.** An invocation is a plain `Effect` run by
  `execute`; the Effect runtime is the engine. There is no worker pool to size,
  no task queue to poll, no YAML/JSON definition — the workflow *is* the
  `Effect.gen` body.
- **The journal is the execution record, not the entity store.** Step outcomes
  go in the journal; durable *entity* state (a user, a cart) belongs in
  `DurableTable`. Keep them separate — the same events→DurableTable split
  Firegrid already draws. Putting entity state in the journal conflates "what
  happened in this run" with "what is true about this entity."
- **Most deferred features are substrate wiring, not new engines.** Durable
  timers, durable waits, durable child sessions, and scheduled triggers are all
  the L0 subscription plane (wake + fencing + lease) plus, for time-based
  triggers, an alarm source — §12. What you build is the intent and the
  predicate; the redrive machinery already exists (and is exercised by the
  `tf-k94k` consumer-substrate witness).
- **The one burden the table cannot remove is determinism.** Control flow must
  be a pure function of (input, journaled outcomes), and step keys must be
  unique per invocation. Everything else maps onto an existing primitive; this
  is the discipline you own (§5–§6), enforced by journaled `Clock`/`Random`
  layers and the LSP lints.

---

## 3. `run` — the only primitive

```ts
export const run: <A, E, R, I = unknown>(
  name: string,
  effect: Effect.Effect<A, E, R>,
  options?: {
    readonly value?: Schema.Schema<A, I>        // journal value schema
    readonly error?: Schema.Schema<E, unknown>  // journal error schema
  },
) => Effect.Effect<A, E | JournalError, R | Journal>
```

A step's wrapped effect settles in one of three ways, and only two are
journaled:

- **Success** → encode the value through its schema, append
  `StepSucceeded { stepKey, value }`, return the value.
- **Typed failure** (the `E` channel) → encode through the error schema, append
  `StepFailed { stepKey, error }`, fail with `E`.
- **Defect or interruption** → nothing is appended; the cause propagates.
  `Effect.either`, which the step uses to split success from typed failure,
  intercepts neither, so the append after it never runs.

On replay, a step whose `stepKey` is already in the journal returns the recorded
value (or re-raises the recorded failure) without executing the wrapped effect
at all. (The current `step` implementation already handles the interruption
case correctly — it is one of the few pieces to keep verbatim.)

**Schema at the boundary, not a cast.** Journaled values must round-trip
through the JSON wire. The current code stores under `Schema.Unknown` and
returns with an unchecked `as A`, which silently corrupts non-JSON-native values
(a `Date` replays as a string, a `Map` as `{}`, `undefined` vanishes) and
defeats determinism. Thread a value schema through `run` and `Schema.decodeUnknown`
the replayed payload — the same schema-as-source-of-truth discipline already
enforced at L1's wire boundary, and it buys version tolerance and corruption
detection. The `error` schema already on `RunOptions` is the same idea for the
failure channel.

**Durable-confirmed.** `run` awaits the journal append before returning, so a
step's outcome is committed before any later step observes it. Do not move the
write onto the batching producer's deferred flush — its throughput optimization
is irrelevant for a journal and the deferral breaks ordering.

---

## 4. Ergonomics — a cookbook

Handlers are plain `Effect`s; `run` is the only addition. The examples below
assume small helpers that return effects (`fetchText(): Effect<string, …>`,
`chargeCard(amount): Effect<Receipt, ChargeError>`, etc.) and named schemas
(`Result`, `Receipt`, …). Inline notes flag where the durable semantics differ
from a non-durable Effect program — the rules behind them are §5–§11.

**Sequential steps.** The baseline. Each `run` is a journal entry; on replay
both are hits and the closures never re-execute.

```ts
import { Effect, Schema } from "effect"
import { run } from "@firegrid/fluent-firegrid"

const greet = (name: string) =>
  Effect.gen(function* () {
    const a = yield* run("step-a", fetchText("/a"), { value: Schema.String })
    const b = yield* run("step-b", fetchText("/b"), { value: Schema.String })
    return `${a}-${b}`
  })
```

**Parallel fan-out with bounded concurrency.** `Effect.all` runs the children
concurrently and collects in input order. Bounded concurrency is a *parameter*,
not the manual chunking loop restate-fluent's guide has to write. Keys must be
unique, so derive them from a stable field (not the loop index if items can
repeat).

```ts
const processBatch = (items: ReadonlyArray<Item>) =>
  Effect.all(
    items.map((item) => run(`process:${item.id}`, processItem(item), { value: Result })),
    { concurrency: 10 },
  )
```

**Race and timeout.** `Effect.race` returns the first to settle and interrupts
the loser. `Effect.timeoutFail` bounds a step.

```ts
const fastest = Effect.race(
  run("primary", fetchPrimary(), { value: Result }),
  run("secondary", fetchSecondary(), { value: Result }),
)

const bounded = run("lookup", slowLookup(), { value: Result }).pipe(
  Effect.timeoutFail({ duration: "5 seconds", onTimeout: () => new Timeout() }),
)
```

> Durable note: an interrupted loser (or timed-out step) is *not* journaled, so
> it re-executes on the next replay (§6, §7). And `timeout` is `Clock`-based —
> a crash during the window re-arms the timeout from scratch on replay, because
> the wait is not yet a durable timer (§11). Make loser side effects idempotent.

**Retry — the sharpest rule.** Retry belongs *inside* the step.

```ts
import { Schedule } from "effect"

// CORRECT — retry within the step; only the terminal outcome is journaled
const charged = run(
  "charge",
  chargeCard(amount).pipe(Effect.retry({ times: 3, schedule: Schedule.exponential("100 millis") })),
  { value: Receipt, error: ChargeError },
)

// WRONG — once the first failure is journaled, replay re-raises it on every
// attempt without re-executing the closure, so the loop spins or exhausts.
const wrong = run("charge", chargeCard(amount)).pipe(Effect.retry({ times: 3 }))
```

**Saga / compensation.** `Effect.onError` runs compensation on failure or
interruption, with the prior step's result in closure scope. Each compensation
step is itself a `run`, so it replays. Cleaner than restate-fluent's hand-written
try/catch chains, and finalizers run uninterruptibly so the compensating append
completes.

```ts
import { Effect } from "effect"

const reserveAndCharge = (itemId: string, amount: number) =>
  Effect.gen(function* () {
    const reservation = yield* run("reserve", reserveItem(itemId), { value: Reservation })
    return yield* Effect.gen(function* () {
      const charge = yield* run("charge", chargeCard(amount), { value: Charge })
      return yield* run("create-order", createOrder(reservation.id, charge.id), { value: Order })
    }).pipe(
      Effect.onError(() => run("release", releaseItem(reservation.id)).pipe(Effect.ignore)),
    )
  })
```

**Cooperative stop and per-task cancellation.** restate-fluent reaches for a
`Channel` + `select` here because it has no per-routine cancel. Effect gives
`Fiber.interrupt` directly — prompt, and it runs the worker's finalizers:

```ts
import { Effect, Fiber } from "effect"

const supervised = Effect.gen(function* () {
  const worker = yield* Effect.fork(longRunningWork)   // worker: Fiber
  // …on some condition…
  yield* Fiber.interrupt(worker)                        // runs worker's finalizers
})
```

For in-band cooperative stop (the worker decides what "stop" means), a
`Deferred<void>` raced against the work is the idiom:

```ts
import { Deferred } from "effect"

const stop = yield* Deferred.make<void>()
const worker = yield* Effect.fork(pollLoop.pipe(Effect.raceFirst(Deferred.await(stop))))
// …to request stop…
yield* Deferred.succeed(stop, void 0)
```

**Polling.** `Effect.repeat`/manual loop, with a deterministic step key per
iteration (a counter, never `Date.now()` — same discipline as restate-fluent,
but the determinism is now enforced by the keys and the journaled `Clock`, §5).

```ts
const pollUntilReady = (jobId: string) =>
  Effect.gen(function* () {
    let attempt = 0
    while (true) {
      const status = yield* run(`poll:${attempt++}`, getStatus(jobId), { value: JobStatus })
      if (status.state === "done") return status
      if (status.state === "failed") return yield* Effect.fail(new JobFailed())
      yield* Effect.sleep("5 seconds")   // ⚠ replay hazard until durable timers (§11)
    }
  })
```

---

## 5. Replay is keyed, not positional — the load-bearing invariant

This is the single most important difference from Restate, and it is *forced*,
not chosen.

Restate assigns each journal entry an index in creation order and matches
positionally. That works because its generator body runs single-threaded: it
constructs each `ctx.run` in source order before any combinator awaits.

You cannot reproduce that under Effect. Within `Effect.all([run("a", …),
run("b", …)])` the two steps execute concurrently on separate fibers, and the
order their appends reach the stream is nondeterministic. A creation-order
counter would have to be incremented when the `run(...)` expression is
*constructed* rather than *executed* — making `run` an impure constructor that
mutates per-invocation state, breaking referential transparency and breaking
outright when a user builds an array of step-effects and runs a subset. Keyed
replay is the only model that survives Effect's execution semantics.

The cost is real: **step keys must be unique within an invocation, and
uniqueness is a correctness requirement, not a readability nicety.** Two `run`s
sharing a key collapse — the second silently replays the first's outcome. This
is strictly worse than positional indexing, which would at least distinguish
two sequential same-name calls. Restate users pay nothing for step names;
fluent-firegrid users own key uniqueness.

Make the footgun loud. Hold a synchronous `Set<string>` of consumed keys in the
journal and check-and-insert at the top of `step`, before its first `yield*`.
Because Effect does not preempt a fiber between synchronous statements, the
check-and-insert is atomic even across concurrent same-key fibers, so a key used
twice fails fast as a defect rather than returning the wrong value. A
structured-key helper deriving keys from a logical path reduces accidental
collisions, but the runtime check is what makes the invariant enforceable.

For the common case — a step repeated inside a sequential loop on one fiber —
borrow Inngest's convention: auto-suffix the user's name with the occurrence
count (`charge`, `charge:1`, `charge:2`, …), so a loop body written once gets
distinct keys without the author inventing them. The suffix is deterministic
*only* for sequential repeats on a single fiber; the moment the repeats run
concurrently (`Effect.all` over a list) the occurrence count is nondeterministic
— the same fact that forced keyed-over-positional replay — so concurrent repeats
still require an explicit unique key derived from the item (`process:${item.id}`).
Auto-suffix the sequential case, demand explicit keys for the concurrent one, and
let the consumed-key guard catch the rest.

---

## 6. The determinism boundary

Replay is correct only if handler control flow is a pure, deterministic function
of (input, the sequence of journaled step outcomes). Anything read *outside* a
`run` that can differ between original and replay — wall clock, RNG,
environment, ambient mutable state — diverges the executions and corrupts the
journal match.

Effect makes the fix cleaner than Restate's. Rather than bespoke `now()`/`random()`
primitives, provide journaled `Clock` and `Random` *layers*. Effect routes
`Clock.currentTimeMillis`, `DateTime.now`, `Effect.random`, and friends through
those service tags, so a journaled layer makes every clock and random read in
the handler automatically replay-safe — no new surface, just a different layer
in `execute`. The carve-out is `Clock.sleep`: a journaled clock can journal
*what time it is* but a durable *wait* is the timer-substrate problem (§11, §12),
so the layer journals reads and leaves sleeps to that mechanism.

The `effect-language-service` lints already configured in this workspace —
`globalDate`, `globalRandom`, `cryptoRandomUUID`, `deterministicKeys` — are the
backstop against raw `Date` / `Math.random` / `crypto.randomUUID` slipping past
the layers. Layers first, lints second.

---

## 7. What is journaled, and what re-executes

Only leaf `run` steps are journaled. The concurrency structure — every
`Effect.all`, `Effect.race`, `Effect.fork`, every branch, loop, and pure
computation — is not. Replay re-derives that structure by re-running the Effect;
only the leaves short-circuit against the journal.

For `all` this is invisible: each child step is a journal hit and returns
instantly. For `race` and timeouts it is not. Effect interrupts losers; an
interrupted step appends nothing (§3), so it leaves no journal entry, so it
re-executes on the next replay. Pure losers are free. Side-effecting losers are
**at-least-once per replay** — meaningfully weaker than Restate, which journals
each combinator's outcome once and never re-runs it.

Two qualifiers. First, this is strictly a *combinator-loser* gap: a leaf `run`
that completes is journaled once and is at parity with Restate (whose `ctx.run`
is itself only at-least-once across crashes). Second, the mitigation is ordinary
idempotency. Wrapping a loser's side effect in its own `run` does not fully close
it, because interruption can preempt the append; only a completed step is
journaled.

---

## 8. Concurrency, spawning, and lifetime are Effect's

Everything restate-fluent's "Concurrency" and `onMainExit` sections describe is
replaced wholesale.

- `all` → `Effect.all(effects, { concurrency })`, fails fast on the first error;
  `{ mode: "either" }` is the allSettled shape, `{ mode: "validate" }`
  accumulates.
- `race` → `Effect.race` / `Effect.raceAll`. Note a deliberate difference from
  restate-fluent: Effect interrupts losers promptly (running their finalizers),
  where restate-fluent lets losers run and abandons them later. Effect's behavior
  releases resources eagerly and composes with the durable model — an interrupted
  loser is simply not journaled and re-derives on replay.
- spawn → `Effect.fork` (real `Fiber` handle), `forkScoped` (bounded by the
  enclosing `Scope`), `forkDaemon` (detached). The current `spawn` combinator —
  `fork` immediately followed by `Fiber.join` — is inert: it yields no handle and
  only "works" inside `Effect.all` because `all` already forks. Drop it.

`onMainExit` does not need to exist. Its `"abandon"` vs `"join"` choice is
exactly `forkScoped` vs `forkDaemon`, expressed compositionally instead of as a
global flag — and `forkScoped` is strictly better than `"abandon"` because scope
teardown *runs finalizers* where abandon cannot. The cleanup restate-fluent could
not give a race loser, Effect gives for free.

---

## 9. Cancellation is interruption

restate-fluent's entire cancellation chapter — manual fan-out,
fresh-AbortController-per-cancel, "not sticky" bookkeeping, `{ signal }` plumbing
— collapses into Effect interruption: structured (interrupting a fiber interrupts
its children), finalizer-aware (finalizers run in reverse, uninterruptibly), and
first-class in the `Cause`.

In-flight syscall abort needs no bespoke controller: `@effect/platform`'s
`HttpClient` is interruption-aware, and any `Effect.async`/`Effect.tryPromise`
boundary can wire interruption to an `AbortSignal`. Interrupting the surrounding
fiber aborts the request.

The durable interaction is the thing to internalize. An interrupted `run` is not
journaled, so on replay it re-runs (§7). To record a cancellation *durably* so
replay skips it, catch the interruption and convert it to a journaled outcome
explicitly (Restate's "closure catches and returns" path). Cleanup that journals
belongs in an `Effect.acquireRelease`/`ensuring`/`onError` finalizer — finalizers
run uninterruptibly, so the journaling append completes even as the fiber tears
down, provided the `HttpClient` layer outlives the finalizers (it does when
`execute` provides it around the whole handler).

---

## 10. The write path and the durability model

This is where the current implementation is actually *wrong*, not merely
un-idiomatic.

Under the assumption that holds today — one journal stream per attempt, attempts
serialized by the per-context (Virtual Object) provisioning layer — there is
exactly one logical writer per stream, and plain `DurableStream.append` is
correct and complete. Concurrent steps under `Effect.all` produce concurrent
appends; plain append imposes no sequence constraint, so they land in arbitrary
order and keyed replay reads them back correctly regardless.

```ts
const append = (event: JournalEvent) =>
  DurableStream.append({ endpoint, schema: JournalEventSchema, event }).pipe(
    Effect.asVoid,
    Effect.mapError(toJournalError("Failed to append journal event")),
  )
```

The current `appendWithProducer` + `nextSeq` Ref path should be deleted. It is
wrong three independent ways: it imposes a total `Producer-Seq` order on appends
that are genuinely concurrent, so a step whose seq arrives out of order draws a
`409`/`SequenceGap` (the tests pass only because the in-memory fetch resolves in
submission order); it always writes epoch 0, so it fences nothing — two
concurrent writers both claim epoch 0 and split-brain; and it seeds the counter
from `events.length`, so any real epoch bump starts above seq 0 and the server
`400`s it. It is also redundant — keyed replay already deduplicates a retried
append, since a second `StepSucceeded` for the same key overwrites with the same
value.

The decision pivots on one question: **can two attempts of a single invocation
ever run concurrently?** If the provisioning layer serializes attempts, plain
append is the answer. If it does not, plain append is *also* unsafe — and the
answer is the `DurableStream.producer` Sink (which serializes sends and handles
seq/epoch correctly, as the conformance suite proves) with a per-attempt epoch
bump for fencing, flushed before `run` returns. The current middle ground is
wrong under either reading.

---

## 11. Retry, saga, timers — Effect, with three sharp edges

§4 shows the code; the rules are: retry lives *inside* `run` (around it, replay
re-raises the journaled failure forever); saga/compensation is `Effect.onError` /
`acquireRelease` with `run`-backed finalizers (which run uninterruptibly, so the
compensating append completes); and timers have three tiers of which only the
first is implemented:

1. **Unmanaged `Effect.sleep`** — a replay hazard: not journaled, so replay
   re-executes it and re-waits the full duration.
2. **Wrapped `run("wait", Effect.sleep(d))`** — journals completion, so replay
   skips the wait; but a crash *during* the sleep loses the timer and re-waits in
   full on recovery.
3. **Durable timers** — survive a crash and fire via a wake. These are not a
   gap to fill from scratch; they are L0's subscription plane plus a timer
   trigger (§12).

---

## 12. Leveraging the substrate — the deferred features, wired to the protocol

The journal today touches three operations: `PUT` create, catch-up `GET`, `POST`
append. The deferred components — durable wait, durable timer, durable child,
suspend/resume, completion/attach, dedup, branching, GC — are not engines to
build from scratch; each is a specific protocol guarantee applied. This section
gives the actual operation sequences and names the guarantee each rests on. One
primitive carries most of the weight: **the pull-wake subscription (§6–§7 of the
protocol) is a fenced, leased redrive engine**, and durable wait / timer / child
/ suspend are all specializations of it. Below, `{root}` is the stream-root and
`inv/{id}` is an invocation's journal (a JSON-content-type stream). Everything in
this section is operated by **fluent-runtime**, the host; **fluent-firegrid** only
defines the primitive surface (§1) that these sequences make durable.

The dividing line is worth naming in Inngest's vocabulary: operations are either
*sync* — `run` and pure control flow, which keep the worker resident and run
in-process — or *async* — durable sleep, wait, and child, which **suspend** the
invocation and hand resumption to an external scheduler. Inngest's scheduler for
its async opcodes is its server; ours is the Durable Streams subscription plane
(§12.1). The same split yields a knob for wall-clock-bounded runtimes (a Cloudflare
Worker's CPU limit, say): force an async boundary early — flush the journal and
park after N steps or T elapsed — so a long run checkpoints and resumes on a fresh
worker instead of being killed mid-flight. That is Inngest's checkpointing knobs
(`bufferedSteps` / `maxRuntime`) read in reverse: Inngest batches *toward* fewer
suspensions from a per-step-yield baseline, while we yield *away* from an
always-resident one.

### The SDK surface — the primitives that compile to §12.1–§12.8

§12.1–§12.8 are the wire. Above them, the developer never writes an HTTP call or
touches a subscription — they write ordinary `Effect.gen` with a handful of durable
primitives that sit beside `run`. `run` is the *sync* primitive (§3); these are the
*async* ones:

```ts
// durable timer (§12.3)
sleep:      (name: string, duration: Duration.DurationInput) => Effect<void, JournalError, Journal>
sleepUntil: (name: string, at: DateTime.Utc)                 => Effect<void, JournalError, Journal>

// durable wait — CEL predicate over a signal stream, with timeout (§12.2)
awaitEvent: <A>(name: string, opts: {
  match: string                       // CEL over the event (the @marcbachmann/cel-js evaluator)
  schema: Schema.Schema<A>
  timeout: Duration.DurationInput
  stream?: string                     // defaults to inv/{id}/signals
}) => Effect<Option<A>, JournalError, Journal>     // None ⇒ timed out

// durable child / invoke (§12.4) — child is a registered handler, addressable across workers
invoke: <I, O, E>(name: string, child: HandlerRef<I, O, E>, input: I) =>
  Effect<O, E | JournalError, Journal>
```

To the author these read as straight-line code; the suspension is invisible. A drip
campaign that parks for a day between sends:

```ts
const onboard = (userId: string) =>
  Effect.gen(function* () {
    yield* run("welcome", sendWelcome(userId))
    for (let day = 1; day <= 5; day++) {
      yield* sleep(`gap:${day}`, "1 day")          // ← worker exits here; a fresh one resumes a day later
      yield* run(`lesson:${day}`, sendLesson(userId, day))
    }
  })
```

Human-in-the-loop approval with a 48-hour deadline:

```ts
const publish = (draftId: string) =>
  Effect.gen(function* () {
    yield* run("submit", submitForReview(draftId))
    const decision = yield* awaitEvent("review", {
      match: `event.type == "review.decided" && event.draftId == "${draftId}"`,
      schema: Decision,
      timeout: "48 hours",
    })
    return yield* Option.match(decision, {
      onNone: () => run("auto-reject", reject(draftId, "timed out")),
      onSome: (d) => d.approved ? run("publish", go(draftId)) : run("reject", reject(draftId, d.reason)),
    })
  })
```

**The contract that compiles these down to §12.** Every durable primitive — sync or
async — resolves to one journal entry, a `StepSucceeded { key, value }`. The only
difference is *who* writes it. For `run`, the in-process closure produces the value
now. For an async primitive, the value is produced *later*, by the resumer, from a
wake. So an async primitive is a two-phase resolve-or-suspend:

```ts
// internal shape shared by sleep / awaitEvent / invoke
const awaitable = <A>(name: string, register: Effect<void>, schema: Schema.Schema<A>) =>
  Effect.gen(function* () {
    const journal = yield* Journal
    const recorded = journal.find(name)                       // replay after a wake?
    if (Option.isSome(recorded)) {
      return yield* Schema.decodeUnknown(schema)(recorded.value)   // ← resolved: return and continue
    }
    yield* journal.append(Suspended({ key: name }))           // first encounter:
    yield* register                                            //   register the protocol artifact (§12.1–§12.4)
    return yield* Effect.die(new Suspend({ key: name }))       //   then PARK (control signal, see below)
  })
```

`register` is the only part that varies: `sleep` records a timer intent and arms the
alarm (§12.3); `awaitEvent` `PUT`s the subscription on the signal stream (§12.2);
`invoke` starts the child invocation and subscribes to its journal (§12.4). The
`awaitable` shape above, and the `sleep` / `awaitEvent` / `invoke` built on it, live
in **fluent-firegrid** — they reference only the `Journal` interface. The next two
pieces are **fluent-runtime**, the host: it provides the `Journal` `Layer`, catches
the park, and runs the wake loop. `execute`
turns the park signal into a "parked" outcome rather than a failure — modeled as a
defect, not a typed error, so `Suspend` never appears in the handler's `E` (the same
reason interruption lives outside `E`; an interruption-with-reason would serve
equally, but the contract below is what matters, not the halt mechanism):

```ts
const execute = (handler: Effect<O, E, Journal>) =>
  handler.pipe(
    Effect.catchAllDefect((d) =>
      isSuspend(d) ? Effect.succeed(Parked({ awaiting: d.key })) : Effect.die(d)
    ),
    Effect.provide(journalLayer),
  )
```

The resumer (the §12.1 redrive worker) closes the loop: on a wake it appends the
resolution so the replay is a hit, then re-runs `execute`:

```ts
const onWake = (invId: string, wake: Wake) =>
  Effect.gen(function* () {
    const events = yield* readNew(wake.stream, wake.ackedOffset)   // §12.1 GET past acked_offset
    yield* appendResolution(invId, wake.key, events)               // writes StepSucceeded{key, value}
    yield* execute(handlerFor(invId))                              // replay: awaitEvent(key) now hits
    yield* ack(wake)                                               // §12.1 ack / advance cursor
  })
```

That is the whole projection: the developer writes `yield* awaitEvent(...)`; on first
run it journals intent, registers the subscription, and parks (the §12.1 suspend
sequence); on the post-wake replay the resumer has written the resolution, so the
same call is a journal hit and returns the event — execution continues as if it had
blocked in place, even though the process between may have died and moved.

| SDK primitive | resolves to (journal) | on first encounter registers | wire | who writes the resolution |
|---|---|---|---|---|
| `run` | `StepSucceeded{key, value}` | — (runs the closure now) | §10 | the closure, in-process |
| `sleep` / `sleepUntil` | `StepSucceeded{key, void}` | timer intent + alarm-at-T | §12.3 | resumer, on the timer wake |
| `awaitEvent` | `StepSucceeded{key, event \| none}` | pull-wake sub on the signal stream | §12.2 | resumer, on the matching wake |
| `invoke` | `StepSucceeded{key, child exit}` | child invocation + sub on its journal | §12.4 | resumer, on the child's close |

The sections that follow are how each `register` and each resolution is realized on
the wire.

### 12.1 The suspend/resume loop (the primitive everything else reuses)

The guarantee: a pull-wake subscription writes a wake event to an app-owned wake
stream whenever a linked stream's tail passes its `acked_offset` (§7), and the
claim/ack/release cycle is fenced by a per-wake `generation` and bounded by a
`lease_ttl_ms` (§7.2–7.3). That is precisely "park an invocation; wake exactly
one worker to resume it when the awaited thing happens; never let two workers
resume it at once."

One-time setup — the wake channel is an ordinary stream the app must create (§7.2):

```
PUT  {root}/wake/pool
```

Suspend (invocation `inv/42` awaits a signal):

```
POST {root}/inv/42            [{ "_t":"Suspended", "awaiting":"signals" }]   # journal the parked state
PUT  {root}/__ds/subscriptions/wait:42
     { "type":"pull-wake", "streams":["inv/42/signals"],
       "wake_stream":"wake/pool", "lease_ttl_ms":30000 }
GET  {root}/inv/42/signals?offset=<lastSeen>                                 # ← lost-wakeup guard, see below
```

The worker process may now exit; the durable state is the journal plus the
subscription cursor. **The `GET` after the `PUT` is not optional.** A subscription
links an already-existing stream at its *current tail* (§6.2), so a signal that
landed between the invocation's last read and the subscription's creation
produces no wake. Catch-up read once after subscribing; if the condition is
already satisfied, resume now instead of suspending. The protocol makes the
lost-wakeup race explicit rather than hiding it.

The external event, from any process, at any time:

```
POST {root}/inv/42/signals   [{ "type":"approval", ... }]
# server appends to wake/pool: {"type":"wake","subscription_id":"wait:42","stream":"inv/42/signals","generation":7,"ts":…}
```

The redrive worker pool tails the wake channel and races to claim:

```
GET  {root}/wake/pool?offset=<cursor>&live=sse
POST {root}/__ds/subscriptions/wait:42/claim   { "worker":"w3" }
  → 200 { "wake_id":"w_x", "generation":7, "token":"…",
          "streams":[{ "path":"inv/42/signals", "acked_offset":…, "tail_offset":…, "has_pending":true }] }
  # losing workers get 409 ALREADY_CLAIMED and drop it
GET  {root}/inv/42/signals?offset=<acked_offset>     # the new event(s)
GET  {root}/inv/42?offset=-1                          # replay the journal to the await point
# resume: predicate matches → the awaiting step resolves → execution continues → new steps POST inv/42
POST {root}/__ds/subscriptions/wait:42/ack { "wake_id":"w_x","generation":7 }            # heartbeat mid-replay (no done → extend lease)
POST {root}/__ds/subscriptions/wait:42/ack { "wake_id":"w_x","generation":7,
       "acks":[{ "stream":"inv/42/signals","offset":<consumed> }], "done":true }          # → { ok:true, next_wake:false }
DELETE {root}/__ds/subscriptions/wait:42              # only if the wait is satisfied for good
```

Two-layer fencing makes a zombie resumer harmless. The subscription `generation`
fences the *cursor*: a stale worker's ack/release returns `409 FENCED` (§7.3), so
it cannot advance the wait or drop a lease it no longer holds. The producer
**epoch** fences the *journal*: the resumer bumps `Producer-Epoch` on its first
append to `inv/42`, so a zombie's writes draw `403` (§5.2.1). A late worker can
therefore neither resume the wait nor corrupt the journal.

Effect shape (thin): the pool worker is one fiber running the wake-stream tail as
a `Stream` plus, per wake, an `Effect` doing claim → replay (`execute`) → ack;
the parked await inside the handler is a `Deferred` the resumed replay resolves.
The client wraps these HTTP ops; the protocol supplies the guarantees.

Concurrency note: **the subscription is the unit of leasing** — one worker holds
it at a time, and a claim hands that worker every linked stream with pending work
(§7). So one subscription per invocation (`wait:{id}`, created at suspend, deleted
at resume) gives maximum resume parallelism at the cost of subscription churn; a
sharded design — `pattern:"inv/{shard}/*/signals"` over N subscriptions, each with
its own `wake/{shard}` — bounds the subscription count and caps parallel redrive
at N. Pick the partition that matches the waiting-invocation fan-out; it is a real
decision the protocol forces, not a detail to defer.

### 12.2 Durable wait — signal, human-in-the-loop, predicate

This *is* §12.1, with a concrete shape worth pinning down. The awaited stream is
`inv/{id}/signals`; the "predicate" is a CEL expression over the new events, and
the wait carries a timeout. That matches Inngest's `WaitForEvent` (event match +
CEL `if` + timeout, resolving with the matching event or a null/timeout sentinel)
and reuses the CEL evaluator already in this stack — the same `@marcbachmann/cel-js`
the trace oracle runs on. On wake, the resumer evaluates the predicate against the
events read past `acked_offset`: a match resolves the awaiting step with the event
payload; a non-match acks the consumed offset (so the same event does not re-wake)
and stays subscribed. The timeout is itself a durable timer (§12.3) racing the
wait — whichever fires first resumes the invocation, the timeout branch resolving
to the sentinel. This is Restate's awakeable / Inngest's `WaitForEvent`, delivered
by append + wake.

### 12.3 Durable timer and cron — the one piece the protocol does not give

Subscriptions wake on *append*, not on a schedule (§7). A durable timer therefore
needs a trigger that appends at the due instant, and that trigger is the only
non-protocol component:

```
PUT  {root}/__ds/subscriptions/timer:42 { "type":"pull-wake", "streams":["timers/42"], "wake_stream":"wake/pool" }
POST {root}/inv/42  [{ "_t":"Suspended","awaiting":"timer","fireAt":"<T>" }]
# app's alarm source (Durable Object alarm, timer wheel, even cron) records: "at T, POST timers/42"
#   ── at T ──
POST {root}/timers/42  [{ "fire":"<T>" }]    # a dumb scheduled append
# → wakes timer:42 → claim → replay inv/42 to the sleep → journaled clock sees now ≥ fireAt → resume
```

Everything except the append-at-T is §12.1: the wake, the fenced claim, the lease,
the redrive. The alarm source is nearly stateless — it only has to "append a tiny
event at T"; *who* is waiting and *where to resume* live in the journal. Cron is
the same with a recurring trigger. At scale, bucket timers: `timers/{minute}`
linked by glob, one alarm per bucket appends once, and the worker resumes every
invocation whose journaled `fireAt` is now due (the bucket's membership is itself a
small durable stream invocations append their ID to at suspend). This is the
"timer intent + wake + redrive" split — the substrate owns wake/fence/lease/redrive,
you own the clock edge.

### 12.4 Durable child session — a child is a first-class invocation

A child that must survive a parent crash is its own invocation with its own journal
`inv/{childId}` and its own redrive — not an in-memory fiber. Parent↔child
coordination is append + subscription + closure:

- Parent journals `ChildSpawned { childId }`, then suspends awaiting the child's
  terminal event — §12.1 with the linked stream being `inv/{childId}` (the parent's
  `wait:{parentId}` subscription links it).
- Child runs independently. On completion it appends its terminal event and closes
  its journal in one atomic op (§5.2): `POST {root}/inv/{childId}` with body
  `[{ "_t":"InvocationSettled","exit":… }]` and header `Stream-Closed: true`.
- That append advances `inv/{childId}`'s tail → wakes the parent's subscription → a
  worker claims, replays the parent to the spawn point, catch-up reads
  `inv/{childId}` (sees the terminal event and `Stream-Closed`), resolves the child
  handle with the result, and continues.
- Cancellation: append a cancel event to `inv/{childId}/control` (the child's own
  subscription wakes it; it observes cancel, runs compensation, closes), or close
  `inv/{childId}` directly so the child's next redrive sees EOF on its own journal
  and terminates.

Because `inv/{childId}` is an ordinary stream, the same journal also serves live
progress (§12.5) and speculative retry (§12.7) for the child at no extra cost. The
in-process variant — parent stays alive — needs no subscription: just live-tail the
child to EOF (§12.5). The subscription is what buys durability across the parent's
death.

### 12.5 Completion and attach — wait-for-result and query, on closure + live read

The guarantee: closure is a durable, monotonic, idempotent EOF (§4.1), and a live
read of an already-closed stream returns its history and the close signal
immediately (§5.6, §5.8).

Mark completion by appending the terminal event and closing atomically:

```
POST {root}/inv/42  [{ "_t":"InvocationSettled","exit":… }]   + header  Stream-Closed: true
```

Attach to the result — works whether the invocation is done or still running, with
no polling and no callback:

```
GET  {root}/inv/42?offset=-1&live=sse
# running  → SSE delivers journal events live; the data event before control{streamClosed:true} is the outcome
# finished → server replays the history then control{streamClosed:true} immediately, and closes
```

That is "wait for the result of a background job" and "attach to the invocation" as
a single GET. **Open journal = not done** (running, or parked on a wake); **closed
journal = done**, terminal outcome last. A cheap `HEAD {root}/inv/42` (§5.5) reads
`Stream-Closed` without transferring the body when only the status is needed.
Query/progress is the same SSE read consumed for `StepSucceeded` ticks; a one-shot
snapshot is the plain catch-up `GET {root}/inv/42?offset=-1`, returning the whole
journal with `Stream-Up-To-Date: true`. Many attachers collapse onto one origin
read (§10).

### 12.6 Identity, single-writer, fencing — `PUT` idempotency + producer epoch

- **Invocation identity / dedup**: one journal stream per invocation ID, started
  with `PUT {root}/inv/42`, which is idempotent — `201` if new, `200` if it already
  exists with matching config (§5.1). "Submit invocation 42" twice yields one stream
  and a no-op second `PUT`. That is the idempotency key, with no seen-set.
- **Idempotency over input, not just ID**: derive the stream name from a CEL key
  over the input (Inngest's function-level `idempotency` expression, e.g.
  `event.data.cartId`), so two submissions that compute the same key collapse onto
  one stream. Note the durability difference: Inngest's event- and function-level
  idempotency are bounded to a 24-hour window, whereas one-stream-per-key dedups
  for the stream's whole lifetime (TTL-bounded, §12.8) — stronger and longer by
  default.
- **Single-writer / attempt fencing**: the producer **epoch** (§5.2.1). An attempt
  taking over an invocation bumps `Producer-Epoch` on its first append; the prior
  attempt's epoch is fenced with `403`. A durable lock is just a stream whose owner
  holds the highest epoch — the protocol's zombie fencing *is* the lock, no external
  lock service.
- These compose with the subscription `generation` (§7.3) from §12.1: epoch fences
  journal writes, generation fences wake/cursor advances. Two independent fences,
  one owner.

### 12.7 Speculative branching — fork

The guarantee: a fork inherits the source's data up to an offset without copying,
then lives independently (§4.2).

```
PUT  {root}/inv/42-branchA   Stream-Forked-From: inv/42   Stream-Fork-Offset: <decisionOffset>
PUT  {root}/inv/42-branchB   Stream-Forked-From: inv/42   Stream-Fork-Offset: <decisionOffset>
```

Both branches replay the shared journal prefix identically — same input, same
journaled outcomes, so replay is deterministic up to the fork — then diverge. Keep
the winner; `DELETE` the loser (soft-delete cascade reclaims shared data, §4.2).
Forks do not inherit producer state (§4.2), so each branch re-bootstraps its epoch
— which keyed replay tolerates, since step keys are content-addressed, not
sequence-addressed. For Flamelab: fork a real execution journal at a decision span
and replay alternatives against the trace oracle. Few durable-execution substrates
branch history copy-free; this one does.

### 12.8 GC — sliding TTL

Create the journal with a sliding `Stream-TTL` (§5.1): it resets on every read or
write, so an actively-replayed or actively-tailed invocation stays warm while an
abandoned one expires and the server drops it — GC with no sweeper. Audit-retained
runs take a longer TTL or an absolute `Stream-Expires-At`; forked journals follow
the TTL-inheritance table (§4.2).

### What the host builds vs. what the protocol gives

The protocol gives, for free: durability and replay (append + catch-up read +
offsets), the completion/EOF marker (closure), wake + fenced-claim + lease + redrive
(pull-wake subscriptions), single-writer fencing (producer epoch), invocation dedup
(`PUT` idempotency), copy-free branching (fork), and GC (TTL). The irreducible
app-side pieces are exactly three: the **predicate** that decides whether a wake
satisfies a wait, the **clock edge** that appends a timer event at T, and the
**redrive worker loop** that tails the wake channel and drives claim → replay → ack.
All three are **fluent-runtime** (the host); fluent-firegrid contributes the primitive
surface they resolve, not the loop. Everything else in the deferred list is one of the
mechanisms above.

---

## 13. What's deliberately not here

- **The scheduler, `Operation`/`Future` types, `onMainExit`, the current-fiber
  slot, the AbortController dance** — all subsumed by the Effect runtime, scopes,
  and interruption.
- **Per-routine cancellation as a custom primitive** — Effect's `Fiber.interrupt`
  already provides it, with finalizers; this is one of restate-fluent's deliberate
  omissions that is simply present here.
- **Durable timers, durable waits, durable child sessions** — deferred, but §12
  shows each is a wiring of L0's subscription plane (plus, for timers, an alarm
  source) rather than a build from scratch.
- **Flow control** — throttle, debounce, rate-limit, singleton, batching, priority,
  concurrency keys. Inngest bundles all of these into the function definition; here
  they are deliberately out of scope, because they are *admission* policy that gates
  whether and when an invocation starts, not part of the durable step it runs — they
  belong to the orchestration layer (Flamecast). The two pieces that do touch
  durability already fall out of the substrate: run-level idempotency is
  `PUT`-idempotent stream naming, and "singleton" is producer-epoch fencing (§12.6 —
  "skip" honors the existing stream, "cancel" bumps the epoch to fence it).

### Prior art, and where this sits

fluent-firegrid is one entry in a lineage of durable-execution engines. Three
neighbors locate it.

**Restate** is the direct ancestor: restate-sdk-gen is the API this re-derives, and
the inversion of §1 is the whole relationship — Restate builds concurrency on a
durable runtime that owns a scheduler, `Operation`, and `Future`; fluent-firegrid
takes Effect's concurrency as given and keeps only the journal. It is closest on the
surface (`gen` / `run` / `sleep` / `await`) and on the keyed-journal replay model.

**Temporal** (`temporalio/temporal`, `docs/architecture`) is the canonical
event-sourced workflow engine and the deepest prior art for the journal-and-replay
mechanism. It executes a workflow by storing an append-only event history and
replaying it to reconstruct state. Across the three roles: **state** is that history,
persisted by the *History Service* to a sharded database (Cassandra / SQL) whose
shard count is fixed at cluster creation; **coordination** is split between the
History Service (which owns timers and drives progress by enqueuing tasks) and the
*Matching Service* (task queues that user-hosted *Workers* long-poll); **computation**
is the user's Worker processes running Workflow code (deterministic orchestration)
and Activity code (the side-effecting units) through the SDK. Two differences are
load-bearing:

- *Determinism vs keyed replay.* Temporal **requires** workflow code to be
  deterministic and side-effect-free, and replays by re-running it and matching the
  emitted command sequence against history *in order*; concurrency that reorders
  commands, wall-clock reads, and randomness are non-determinism faults the SDK
  rejects. fluent-firegrid makes the opposite bet (§5–§6): it runs the body as
  ordinary Effect *with* concurrency — which makes positional replay impossible —
  and pays for it with mandatory unique step keys. Temporal forbids the concurrency
  that would break positional replay; fluent-firegrid embraces it and keys the
  journal instead. (Temporal's Workflow/Activity split is the same boundary as
  "combinators re-derive, leaf `run` is journaled," §7, but enforced by a
  language-level determinism sandbox rather than `run` discipline plus journaled
  `Clock`/`Random`.)
- *Substrate.* Temporal's state and coordination live in a stateful cluster —
  History + Matching services over a sharded database, self-hosted or Temporal Cloud.
  fluent-firegrid's live in the Durable Streams protocol: append-only HTTP logs plus
  the subscription plane, CDN-friendly and language-agnostic (§1). The same two roles,
  on a workflow-orchestration cluster versus a stream protocol.

**Electric Agents** (ElectricSQL) is the closest substrate sibling: a durable agent
runtime on the *same* Durable Streams protocol — it ships against `localhost:4437`,
the protocol's default port, and reuses fork, closure, and the subscription plane.
It independently lands on the same three roles (stream-per-entity for state, wakes
for coordination, a loop for computation), which is strong external evidence that
§12's central claim — Durable Streams subscriptions are a coordination runtime, not
just storage — is real and shipped by the protocol's authors. It diverges on two
axes: its **computation is agent-specialized** (the role is hard-wired to an LLM
loop, `ctx.useAgent()` → `ctx.agent.run()` over Mario Zechner's pi, with tools as the
work unit) where fluent-firegrid keeps computation general (any Effect under `run`);
and it **bundles what this stack splits** — it fuses the event stream, a TanStack-DB
projection (`EntityStreamDB`), wakes, and the agent loop into one runtime, where the
equivalent pieces here are factored across fluent-firegrid, a DurableTable projection,
and Firegrid, with the one-log rule (§12.6) keeping the stream authoritative and the
projection a read model.

The deeper point is that Electric Agents is prior art for a *different layer*.
Temporal, Restate, and fluent-firegrid are durable-*workflow* engines: a body runs,
parks on durable promises, and is replayed. Per the fluent-runtime architecture this
serves, fluent-firegrid is deliberately scoped to that role — **coordination
workflows, sagas, and authored multi-step procedures** — and explicitly *not* to the
agent session, which is host-driven: an external harness owns the model loop and the
host reacts per wake. So Electric Agents' "loop as durable runtime" is the road not
taken here; the loop stays outside, and fluent-firegrid supplies durability to the
coordination *around* it. It is the workflow engine beneath an agent host, not an
agent runtime itself.

---

## 14. Testing

`TestClock` for deterministic time; the in-memory Durable Streams fetch (already
written) provided as a `FetchHttpClient.Fetch` layer for the journal — fast,
deterministic, no server. The defining test is the replay test: run a handler
against an in-memory journal, run it again against the same journal, and assert
side effects fire exactly once (the `executions.count === 1` shape already in the
suite). `@effect/vitest`'s `it.effect` / `expectEffect` ties this into the typed
Exit-bridge work already underway. Properties worth holding: key uniqueness is
enforced, replay is outcome-deterministic, and an interrupted step leaves no
journal row.

---

## 15. Handler shape

A handler is `(input: I) => Effect<O, E, R>`, written with `Effect.gen`, using
`run` for durable steps. The `service` / `object` / `workflow` registry stays —
it is metadata plus binding — but the handlers it holds are plain
Effect-returning functions. Drop `invocation.ts`'s arity-sniffing
(`handler.length >= 2`) and the `GeneratorHandler` / `Operation` distinction:
there is one handler shape, and it returns an `Effect`.

```ts
import { Effect, Schema } from "effect"
import { run, service } from "@firegrid/fluent-firegrid"

export const greeter = service({
  name: "greeter",
  handlers: {
    greet: (name: string) =>
      Effect.gen(function* () {
        return yield* run("compose", Effect.sync(() => `Hello, ${name}!`), {
          value: Schema.String,
        })
      }),
  },
})
```

`execute(ctx, effect)` provides the journal layer and `HttpClient` and runs the
effect — the current `execute.ts`, minus the producer bug of §10.

---

## 16. Summary of guarantees

- A `run` step executes at most once to a journaled outcome per invocation —
  modulo crash-before-append, which is at-least-once, the same bound as Restate's
  `ctx.run`.
- Replay returns journaled outcomes *by key* without re-executing; non-`run` code
  and concurrency combinators re-execute and re-derive structure.
- Step keys must be unique per invocation; collisions are detected and fail fast.
- Control flow must be deterministic in (input, journaled outcomes); journaled
  `Clock`/`Random` layers make time and randomness replay-safe.
- Concurrency, interruption (with finalizers), and scoping are Effect's,
  unchanged.
- An interrupted or defected step leaves no journal entry and re-runs on replay,
  unless explicitly caught and journaled.
- Retry belongs *inside* `run`; saga/compensation via `Effect.onError` /
  `acquireRelease` and finalizers.
- The journal is durable-confirmed: a step's outcome is committed before any
  downstream step observes it.
- Completion, observability, suspension/resume, speculative branching, GC, and
  ownership-fencing are all available from the substrate (closure, live tail,
  subscriptions, forking, TTL, producer epoch) — §12 — not features to be rebuilt.