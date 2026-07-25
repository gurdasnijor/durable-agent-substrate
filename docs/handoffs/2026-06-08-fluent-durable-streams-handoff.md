# 2026-06-08 Fluent / Durable Streams Handoff

## Current Direction

The current architectural direction is **Durable Streams substrate first**.

Do not grow `fluent-runtime`, a Firegrid host, or a control surface until the
generic Durable Streams protocol/client semantics are concrete and covered by a
vertical slice. The repeated failure mode has been rebuilding substrate
mechanics in Firegrid-shaped runtime code, which made ownership boundaries muddy
and restarted the project several times.

The working rule:

- If a durable mechanism can be described without Firegrid product nouns, push it
  down to `durable-streams` or specify it there first.
- `fluent-firegrid` should stay a thin Effect-native authoring package.
- Any host/deployment/control binding is deferred until the substrate and
  authoring contracts are stable.
- `packages/durable-streams/PROTOCOL.md` is the source of truth for Durable
  Streams semantics.

## Repositories / Checkouts

Primary Firegrid checkout:

- `/Users/gnijor/gurdasnijor/firegrid`

New fluent-firegrid workspace:

- `/Users/gnijor/gurdasnijor/fluent-firegrid`
- Durable Streams fork lives under:
  `/Users/gnijor/gurdasnijor/fluent-firegrid/packages/durable-streams`
- Effect client package lives under:
  `/Users/gnijor/gurdasnijor/fluent-firegrid/packages/durable-streams/packages/effect-durable-streams`

There is also a standalone checkout:

- `/Users/gnijor/gurdasnijor/durable-streams`

Be careful: prior active PR work was done from the nested Durable Streams
checkout under `fluent-firegrid/packages/durable-streams`, not necessarily the
standalone checkout.

## Important User Decisions

The user explicitly decided:

- Durable Streams docs and implementation must not directly reference Firegrid;
  the goal is still to make the work upstreamable to `durable-streams`.
- Do not preserve greenfield compatibility for older `/consumers` language if it
  conflicts with the protocol target.
- For filtered subscriptions, adopt the CEL library already in use. Do not spend
  time reopening the filter-language decision.
- Auth is deployment/operational layer concern.
- In-memory implementation is fine for now; do not over-design storage concerns.
- The protocol is the source of truth. Do not fixate on spike code.
- Stop modeling the Effect client as CRUD-ish REST wrappers. The client API must
  model operation semantics.

## Correct Effect Client Direction

The bad direction to avoid:

- `DurableSubscriptionClient`
- `Subscription.put`
- `Subscription.createOrConfirm`
- Endpoint-by-endpoint CRUD wrappers
- Inventing a worse local RPC model over the protocol

The desired shape, based only on `packages/durable-streams/PROTOCOL.md`, is
semantic:

- Log plane: reads/writes as `Stream`/`Effect`, with offsets as opaque ordered
  tokens and protocol EOF as stream completion where appropriate.
- Writer identity plane: producers are scoped, stateful, fenced resources.
  Producer fencing is a typed recoverable error; duplicate producer appends are
  success/control flow, not application errors.
- Coordination plane: subscription claims are scoped leases. Heartbeats run in
  scope. Generation fencing should interrupt the work region so torn double
  commits are avoided.
- Schedules: delayed producer-fenced append, reusing the same producer/idempotency
  tuple semantics as normal writes.
- Webhooks/JWKS: handler-side verifier layer with JWKS cache and replay-window
  checks. This is not application boilerplate.
- Transport should be an Effect Layer / HTTP seam. The value is the semantic
  mapping of distributed invariants into `Stream`, `Effect`, `Scope`,
  interruption, and typed errors.

## Durable Streams PR State

Open PR:

- `gurdasnijor/durable-streams#4`
- URL: https://github.com/gurdasnijor/durable-streams/pull/4
- Branch: `codex/protocol-target-guardrails`
- Latest known pushed commit: `87f781f3 Align subscription filters with protocol target`

Current content of that PR:

- Rejects unsupported `filter` on reserved subscription requests until filtered
  subscriptions are implemented.
- Adds conformance that rejected filters create no subscription state for
  pull-wake and webhook.
- Deletes `docs/layered-consumer-spec.md`.
- Deletes the bad doc:
  `packages/effect-durable-streams/docs/coordination-substrate-client.md`.
- Adds replacement doc:
  `packages/effect-durable-streams/docs/reserved-protocol-bindings.md`.
- Updates:
  - `docs/sdds/durable-streams-pushdown-sdd.md`
  - `features/durable-streams/coordination-substrate.feature.yaml`
  - `packages/effect-durable-streams/README.md`

Known issue: `reserved-protocol-bindings.md` is still too thin. It avoids the
bad CRUD wrapper names, but it does not yet capture the richer semantic client
design described above. The next agent should replace or amend it before trying
to build the Effect client.

Checks that passed earlier on that branch:

- `pnpm exec vitest run --project server packages/server/test/conformance.test.ts -t "Reserved subscription APIs"`
- `pnpm --filter @durable-streams/server-conformance-tests typecheck && pnpm --filter @durable-streams/server typecheck`
- `pnpm exec eslint packages/server/src/subscription-routes.ts packages/server-conformance-tests/src/index.ts`
- `git diff --check`

After later doc-only amendments, tests were not rerun.

## Firegrid PR State After This Session

Open PRs were triaged and actions were taken on GitHub.

Merged:

- `firegrid#979`
- URL: https://github.com/gurdasnijor/firegrid/pull/979
- Title: `docs(tf-tiey): forbid host self-drive as feature acceptance`
- Merge commit: `eda2d76661730372b815524bd17b3854a9b19130`
- Why: valid methodology guardrail. It prevents host self-drive from satisfying
  feature acceptance.

Closed:

- `firegrid#981`
- URL: https://github.com/gurdasnijor/firegrid/pull/981
- Why: superseded by the substrate-first docs reset and still framed too much
  around `fluent-runtime` host/control shape.

- `firegrid#977`
- URL: https://github.com/gurdasnijor/firegrid/pull/977
- Why: implementation grew `fluent-runtime` / control-surface path before
  Durable Streams substrate and Effect client semantics were settled.

Still open / draft:

- `firegrid#985`
- URL: https://github.com/gurdasnijor/firegrid/pull/985
- Title: `docs(tf-6am3): clarify fluent-firegrid host boundary`
- Status: draft, clean, CI green when last checked.
- Disposition: keep as docs-reset candidate. Review carefully before merge for
  any remaining wording that accidentally re-blesses concrete host/control
  surface shape.

- `firegrid#976`
- URL: https://github.com/gurdasnijor/firegrid/pull/976
- Title: `test(tf-88bd.1): real spawned ACP agent acceptance (fluent ACP client)`
- Status: draft, clean.
- Disposition: parked, not closed. Real spawned ACP evidence is useful, but
  should not merge ahead of the substrate-first vertical slice. Re-evaluate after
  deciding whether the evidence belongs in Firegrid or the new fluent-firegrid
  repo.

Current Firegrid open PR list after actions:

- `#985` docs reset candidate
- `#976` parked ACP evidence

## Firegrid Local Checkout State

At the time this handoff was written:

- Current branch: `main`
- Tracking: `main...origin/main`
- Pre-existing untracked file:
  `docs/proposals/fluent-firegrid-design-alignment.md`

That untracked proposal file was already present before this handoff. Do not
attribute it to this session unless you inspect it.

This handoff file is the only local file added by this final handoff step.

## Relevant Review / Retro

Read this before doing more Fluent implementation:

- `docs/reviews/2026-06-05-fluent-runtime-retro.md`

Key retro conclusion:

- Freeze new `fluent-runtime` expansion.
- The next mergeable implementation slice should prove one end-to-end
  substrate-backed path, not broad control plane or host scaffolding.
- Avoid broad API/server, projection/read-model, child race/join, broader MCP
  catalog, and similar expansions.

The retro's useful vertical acceptance target was:

1. Durable Streams subscription wake arrives.
2. Worker claims lease.
3. `handleSession(wake)` materializes state.
4. External harness is driven/resumed.
5. Harness calls `wait_for`.
6. `wait_for` records intent before park and ends harness turn.
7. External event append matches CEL predicate.
8. Subscription wakes worker.
9. Worker reclaims, redrives, resolves from journal, and acks.

But given the later direction, build the Durable Streams substrate semantics
first, then decide what Firegrid-side proof remains.

## Next Safe Work Sequence

1. In `gurdasnijor/durable-streams#4`, amend the Effect client design doc so it
   models semantics, not endpoints.
2. Keep Durable Streams generic and Firegrid-free.
3. Implement the smallest protocol-conformant substrate vertical slice:
   subscription registration, filtered matching with CEL, claim/lease/ack/release
   semantics, and schedule behavior as specified by `PROTOCOL.md`.
4. Put conformance coverage under:
   `packages/effect-durable-streams/test/conformance`
   where appropriate for client-driven accepted conformance.
5. Add server conformance coverage under:
   `packages/server-conformance-tests`
   for server behavior.
6. Only after the substrate and Effect client semantics are credible, return to
   `fluent-firegrid` and expose a thin authoring API over those semantics.
7. Do not reintroduce `fluent-runtime` host/control implementation as the first
   proof.

## Interaction Notes For Next Agent

The user was right to push back hard on endpoint-shaped client designs. Do not
propose another REST wrapper surface. Start from the protocol semantics and
explain what invariant each API shape preserves.

When discussing architecture, be concrete:

- name imports,
- name exposed APIs,
- name who owns writes,
- name who owns lease/claim/ack,
- name what is substrate vs product semantics.

Avoid vague phrases like "control surface", "runtime", "host", or "journal
interface" unless you immediately define exactly what imports and endpoints that
means.

