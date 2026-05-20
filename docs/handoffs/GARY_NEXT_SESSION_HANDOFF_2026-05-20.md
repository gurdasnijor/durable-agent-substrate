# Gary Next-Session Handoff

Date: 2026-05-20
Repo state used: `origin/main` at `7ecaa9102`

## Read First

1. `docs/architecture/host-sdk-runtime-boundary.md`
2. `docs/handoffs/COORDINATOR_HANDOFF_canonical_convergence_2026-05-20.md`
3. `docs/handoffs/GARY_ARCHITECTURE_ASSESSMENT_2026-05-20.md`
4. `.dependency-cruiser.cjs`
5. `docs/research/tf-lwqm-spawn-all-wiring.PROPOSAL.md`

The boundary architecture is no longer in discovery mode. Treat the canonical
doc as law unless Gurdas explicitly changes the firewall.

## Current Mental Model

The target architecture is:

```text
protocol schema catalog
  -> host/client/CLI bindings
  -> runtime execution substrate
```

Channels are the app/agent semantic surface. Workflows, durable streams, table
CDC, engine services, execution ids, and stream URLs stay below that surface.

The system is now roughly **90-93% converged**. The old 65% convergence doc is
historically useful, but stale after PRs #518, #519, #522, #524, #525, #526,
#527, and #528.

## What Landed After The 65% Assessment

- `durable-tools` final deletion: #519.
- More RuntimeAgentToolExecution arms: #518.
- More schema projection: #522 and #525.
- More guardrail ratcheting: #520, #524, #526, #528.
- Deterministic factory smokes through sleep and waitFor: #516 and #527.
- Driver/run bounding for dark-factory: #521.
- Spawn/delegation proposal: #523.

Do not accidentally reason from the pre-#519 world. `durable-tools` is gone on
`origin/main`.

## Objective Scoreboard

Use `.dependency-cruiser.cjs` `currentHostSdkSubstrateDebt` as the scoreboard.
As of `7ecaa9102`, 8 files remain:

- `packages/host-sdk/src/agent-tools/execution/tool-use-to-effect.ts`
- `packages/host-sdk/src/agent-tools/execution/toolkit-layer.ts`
- `packages/host-sdk/src/host/control-request-reconciler.ts`
- `packages/host-sdk/src/host/internal/runtime-context-helpers.ts`
- `packages/host-sdk/src/host/runtime-context-workflow-core.ts`
- `packages/host-sdk/src/host/runtime-context-workflow-runtime.ts`
- `packages/host-sdk/src/host/runtime-input-deferred.ts`
- `packages/host-sdk/src/host/session-log-channel.ts`

Every next-wave architecture answer should reduce, explain, or preserve this
list. If a lane touches one of these files and does not shrink the carveout or
explain why it remains, ask for clarification.

## Recommended First Response Next Session

If asked "what now?", answer:

1. Decide `session_new_all` vs legacy `spawn_all` mutation. Recommend
   `session_new_all`.
2. Dispatch a narrow carveout-reduction lane against one or two files from the
   8-file list.
3. Dispatch external-trigger planning for Linear verified webhook -> channel ->
   planner.
4. Keep one lane free for guardrail/rebase repair.

## Decisions I Would Stand Behind

- Keep `FiregridRuntimeHostLive` stable. Rename later, if at all.
- Do not introduce `@firegrid/host-runtime` yet. Runtime remains the lower-tier
  execution home.
- Do not reopen the old channel registry debate. `ChannelInventory` is an edge
  inventory/metadata adapter, not a mutable app registry.
- Use `session_new_all` for running child session handles. Do not overload
  terminal `spawn_all`.
- Treat engine-native `streamWait/streamWaitAny` as performance-triggered, not
  a blocker for private beta.
- Keep verified webhook implementation in runtime; move/provide public fact
  schemas through protocol when a binding observes them.

## Watchpoints

- If anyone proposes passing workflow handles or execution ids through channels,
  push back immediately. That violates the canonical firewall.
- If host-sdk grows new common execution behavior, ask why it is not a runtime
  service.
- If runtime imports host-sdk, stop the lane. The guardrail should catch it, but
  the architectural review should catch it first.
- If durable-tools or wait-router names reappear, assume regression until proven
  otherwise.
- If a PR claims "ratchet" but `.dependency-cruiser.cjs` carveouts do not
  shrink, read the finding carefully. It may still be valuable if it proves no
  safe ratchet is available.

## Useful Commands

```bash
git fetch origin main
git log --oneline origin/main -n 20
git show origin/main:.dependency-cruiser.cjs | sed -n '1,40p'
git grep -n "@firegrid/host-sdk" origin/main -- packages/runtime/src
git grep -n "@firegrid/runtime/durable-tools\\|wait_router\\|DurableTools" origin/main -- packages
bash scripts/lane-sweep.sh --json
gh pr list --state open --limit 20 --json number,title,isDraft,mergeStateStatus,statusCheckRollup,url
```

## If Asked To Dispatch

Prefer dispatches with this structure:

```text
READ:
  docs/architecture/host-sdk-runtime-boundary.md
  .dependency-cruiser.cjs currentHostSdkSubstrateDebt

SCOPE:
  one or two named files only

ACCEPTANCE:
  pnpm run lint:deps
  pnpm run verify or focused package checks
  rg/grep proving the removed boundary leak
  currentHostSdkSubstrateDebt reduced or unchanged with a finding explaining why
```

Avoid broad prompts like "move host-sdk to runtime." That failure mode is already
named in the canonical doc.

## Current Private-Beta Read

Private beta is plausible after:

- `session_new_all` lands;
- deterministic factory smoke covers delegation;
- one external trigger path or a clearly accepted synthetic trigger path is
  declared beta-sufficient;
- one real side-effect adapter is either implemented or explicitly deferred from
  the first beta story;
- guardrails are green with carveouts understood.

The system does not need engine-native primitives before private beta unless
performance data says Firegrid overhead is approaching a meaningful fraction of
LLM/provider latency.

## Human Context

Gurdas has been pushing correctly against accidental registry/substrate leakage.
If there is a disagreement, reduce it to the canonical analogy:

```text
Do not pass DB drivers through business logic.
Do not pass workflow engines through agent/application code.
Channels are the semantic application surface.
Runtime owns the machinery below it.
```

That framing has consistently clarified the right move.
