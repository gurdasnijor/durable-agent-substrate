# Handoff — PR #765 unified-kernel core green-up

Date: 2026-05-31
Author: OLA2 (review/green-up lane)
For: next agent continuing the #765 green-up

## TL;DR

PR **#765** ("feat: unified subscriber kernel", head `sim/unified-kernel-validation`
@ `fabf9bb46`, **base `main`** `cf9db127c`, +12k/−71k, 486 files) collapses Firegrid
to one substrate (`Channel` + `DurableTable` + `Workflow` + durable `signal`) and
deletes Shape C. The PR description claims green; **it is not** — eslint was failing
first and masking everything downstream.

I did the **"green-up core only"** pass (user-chosen scope). Work lives **uncommitted**
in worktree `/Users/gnijor/gurdasnijor/firegrid-worktrees/pr765-review` on branch
`sidecar/pr765-core-greenup` (branched off the PR head; `git diff origin/sim/unified-kernel-validation`
shows the changeset, 26 files, +41/−2668).

**8 CI gates now green. 3 remain red.** The user's pending decision is **A/B/C** on the
last 3 (see §"Pending decision"). User leaning unstated; I recommended **A** (real fixes).

## Branches / where things are

- PR head: `origin/sim/unified-kernel-validation` @ `fabf9bb46` (base = `origin/main` `cf9db127c`; clean branch, merge-base == main head).
- My work: branch `sidecar/pr765-core-greenup` in worktree `firegrid-worktrees/pr765-review`. **NOT committed** — changes are in the working tree. `git stash`/commit as you see fit; suggest committing before continuing so you can iterate safely.
- NEVER work in the primary checkout `/Users/gnijor/gurdasnijor/firegrid` (other agents drive it).

## Gate status (verified fresh on this branch)

GREEN:
- `pnpm typecheck` (16/16)
- `eslint . --max-warnings 0` (was 194 errors → 0)
- `pnpm test` (protocol 82/82, client-sdk 5/5, runtime 126/126, tiny-firegrid 37/37, observability 9/9, durable-operators 29/29, durable-streams 70/70)
- `pnpm lint:deps` (0 violations)
- runtime-public-surface guard, legacy-roots-scoreboard, type-only-edge, test-layout — all OK

RED (3 — all pre-existing PR-author debt in the new `unified/` module, masked behind the eslint failure; my changes only reduced them):
1. **`effect:diagnostics`** (runs as the LAST step of `pnpm lint`, so `pnpm lint` exits 1 here):
   "regression: 2 errors, 11 warnings, 9 messages above baseline."
   - 2 ERRORS `effect(missingReturnYieldStar)`: `packages/runtime/src/unified/signal.ts:180` and
     `packages/runtime/src/unified/subscribers/runtime-context.ts:110` — both the
     `yield* Workflow.suspend(instance); return yield* Effect.never` park idiom. Type-delicate
     (suspend returns void; `Effect.never` supplies the `never`). Fix carefully.
   - 10× WARN `effect(layerMergeAllWithDependencies)` in `packages/runtime/src/unified/channel-bindings.ts`
     lines ~375,495–504 — `UnifiedChannelBindingsLive` / `UnifiedSignalingChannelBindingsLive`
     `Layer.mergeAll` where some Lives require `SignalTable`/`WorkflowEngine` provided by a sibling.
     Diagnostic says use `Layer.provideMerge`. This is the stub-vs-signaling two-layer composition
     (see §Architecture). Real restructure.
   - 1× WARN `globalErrorInEffectCatch` at `scheduled-webhook-peer.ts:148`.
   - Baseline lives behind `scripts/tooling.mjs effect diagnostics` / `lint:effect-quality:baseline`.
2. **`pnpm lint:dup`** (jscpd) = 82 cloned lines (baseline 0). Clones are in
   `channel-bindings.ts` (stub vs signaling `append` blocks, e.g. [230–242]≈[272–284], [456–465]≈[473–482]).
   Rebaseline cmd: `pnpm lint:dup:baseline`.
3. **`pnpm lint:dead`** (knip) = 21 over baseline. Raw `npx knip` shows more (baseline already
   accepts most); net-new 21 are the UKV sim's not-yet-consumed public surface
   (`simulations/unified-kernel-validation/{channels,tables,signal,durable-event-channel}.ts`
   exports) plus `runtime/src/events/agent-output.ts` + `tables/runtime-control-plane-time.ts`
   flagged as unused files. Rebaseline cmd: `pnpm lint:dead:baseline`.

## Pending decision (user has NOT chosen)

- **A (recommended):** real fixes — restructure `channel-bindings.ts` stub+signaling composition
  to `Layer.provideMerge` (kills the 10 layerMergeAll warns AND most of the 82 dup), fix the 2
  park-idiom errors, prune/markused the ~21 dead exports. Few hundred lines of careful `unified/`
  work + retest. Rebaselining would bury the half-finished-composition debt the SDD already defers.
- **B:** update effect-quality + jscpd + knip baselines (fast green, records debt), refactor as follow-up.
- **C:** stop, hand to CC6.

## What I changed (changeset, uncommitted)

Deletions (finishing the deletion — orphan tests importing deleted sims):
`client-sdk/test/firegrid.channels.test.ts` (experiment-framed, broke by the intentional
"FiregridLive no longer provides standalone channel defaults" change — flag: client channel-facade
coverage dropped, re-author at integration layer as follow-up), and tiny-firegrid orphan tests:
`agent-coordination-readiness/`, `agent-runtime-fixture-replay-harness`, `agentic-patterns-primitive-profile`,
`dark-factory-driver`, `shape-c-channel-router-turn/`, `shape-d-tool-dispatch-mcp-entry/`,
`sleep-only-substrate-smoke`, `spike-channel-deletion/`, `wave-d-a-shape-b-input-identity-dedup/`.

Edits:
- `runtime/src/unified/host.ts` — **fixed real bug**: `FiregridHost({toolExecutor})` override was
  dead (factory always used the echo executor); option type was wrong (`Layer` → `Effect`), now
  honored. Also fixed unsafe-assignment + removed unused `WorkflowEngine` import.
- `protocol/test/channels/session-permission.test.ts` — response asserted old `{responded,…}`; the
  schema already shipped as `EventOffset` (`{offset, deduplicated?}`). Updated test to match. (NOT a
  duplicate-schema bug — my first read of session-permission.ts was a Read-tool hallucination; the
  single def is `= EventOffsetSchema`.)
- `client-sdk/src/firegrid.ts` — reworded the comment at ~1421 that contained `@firegrid/runtime/…`
  (boundary test greps raw source for that literal).
- 3× `production-flow-*scenario.ts` — `<T,>`→`<T>` (comma-dangle); `process.env` allow-comments
  (`effect-quality-allow-process-env` marker) in `production-flow-acp-live-scenario.ts` + `bin/fake-acp-agent-process.ts`.
- `permission-and-tool.ts` — removed dead `SessionTargetSchema`. `observers.ts` — inline `import()`
  type → top-level `import type`. (`eslint --fix` cleared the bulk: type-imports + unnecessary-assertions.)
- Docs/guard for the `unified/` tier: `packages/runtime/src/README.md`, `docs/sdds/SDD_FIREGRID_RUNTIME_BOUNDARY_RECONCILIATION.md`,
  `scripts/runtime-public-surface-check.mjs` (requiredTargetSurfaces: dropped `subscribers`+`composition`,
  added `unified`), and new `packages/runtime/src/unified/README.md`.
  NOTE: `docs/architecture/2026-05-22-runtime-physical-target-tree.md` still describes the old
  subscribers/composition tiers in prose — NOT gating (guard hardcodes the list), left as doc follow-up.

## Architecture review findings (the deeper picture — core write/signal path is SOUND)

- `ProductionCodecAdapterLive` (codec-adapter.ts) is real production scaffolding (per-context Scope.fork,
  output-drain daemon, registry, env policy, codec selection). Permission/tool workflows clean
  (idempotencyKey + Activity memoization + sendSignal relay). `JournalObserverLive` is a single
  long-lived subscription → avoids the tf-7kq8 replay storm. Both #738 races preserved + regression-tested.
- **Deferred (user-approved follow-ups, NOT in this PR):**
  - Schema collapse is **half-applied**: channel REQUEST schemas still old behind `as never` casts in
    `channel-bindings.ts` (~15 casts); only some RESPONSE schemas became `EventOffset`.
  - Read side is **stubbed empty**: `HostContextSnapshotChannelLive`/`HostSessionSnapshotChannelLive`
    return empty; `HostContextsChannelLive`/`SessionLifecycleChannelLive` return `Stream.empty`.
  - `channel-bindings.ts:330` dynamic `import()` to dodge a module cycle; dead `encodePermissionResponsePayload`
    kept alive by a `void` ref; fabricated `toolUseId` in HostPermissionRespond signaling.
  - Stub channel Lives only work because `Layer.mergeAll` right-wins puts signaling over them
    (`host.ts:261`) — implicit, no test pins it. (This is also the source of the dup + layerMergeAll gate failures.)

## Strategic / coordination (NEEDS USER DECISION, separate from green-up)

#765 → `main` deletes Shape C wholesale, **abandoning the 156-commit `rearch/shape-c-cutover` line +
~9 open PRs** (body names #757/759/761/762/764 for closure; ~4 others on that base become moot; #738/RCSW
already merged INTO rearch). Nothing correctness-wise lost (race fixes preserved in `unified/`), but the
rearch-PR closures + branch disposition are an un-actioned decision.

## Resume instructions

1. `cd /Users/gnijor/gurdasnijor/firegrid-worktrees/pr765-review` (if gone:
   `git worktree add <path> sidecar/pr765-core-greenup`, then `pnpm install`).
2. Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm lint:dep && pnpm lint:dup && pnpm lint:dead`.
   Per-gate precise locations: `eslint . -f unix`, `node scripts/runtime-public-surface-check.mjs`,
   `node scripts/tooling.mjs effect diagnostics`, `npx knip --no-progress`, `node scripts/jscpd-check-baseline.mjs`.
3. For path A, start in `channel-bindings.ts` (provideMerge restructure fixes layerMergeAll + most dup
   in one move), then the 2 signal/runtime-context park-idiom errors, then knip dead exports.

## Environment gotchas (cost me real time)

- **The Read tool intermittently returns HALLUCINATED content** (phantom bulleted lists / "wait not present"
  lines) for some files this session. TRUST `grep`/`sed`/`cat`/`git diff` over Read for exact strings; verify
  Edit `old_string` against authoritative bash output. (3 of my doc edits silently failed against hallucinated text.)
- **Bash output is heavily DEFERRED/batched** — results may render an iteration or two later, all at once.
  Don't re-fire assuming a command failed; write to a file and read it back.
- Shell **cwd resets between calls** — always `cd <abs> &&` prefix; a failed `cd` in a parallel batch
  cancels the WHOLE batch.
- macOS has **no `timeout`** — don't use it to bound sims.
