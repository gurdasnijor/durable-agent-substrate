# Gary Architecture Assessment — Canonical Convergence

Date: 2026-05-20
Assessed main: `7ecaa9102` (`tf-ygz3 Lane D slice 7`, PR #528)
Audience: coordinator handoff / next-wave dispatch

## Current Verdict

Firegrid is now **about 90-93% converged** on the target architecture from
`docs/architecture/host-sdk-runtime-boundary.md`.

That number is materially higher than the earlier `tf-k4uo` assessment because
the load-bearing wave after PR #512 landed the big missing pieces:

- `packages/runtime/src/durable-tools/` was finally deleted in PR #519.
- `ChannelRegistry` was replaced by Effect-native channel Tags plus
  `ChannelInventory` in PR #502.
- Runtime-owned workflow definitions moved under runtime paths across PRs
  #499, #503, and #507.
- `RuntimeAgentToolExecution` is now a real runtime execution seam, not just a
  proposal: PR #504 plus PR #518 moved the first meaningful tool arms.
- Dependency guardrails are hard-error, with explicit debt carveouts now reduced
  to 8 files by PRs #509, #520, #524, #526, and #528.
- Schema projection moved several shared shapes into `@firegrid/protocol`,
  including observations, verified-webhook schemas, projection helpers, and
  operation-entry wrapper cleanup.
- Dark-factory deterministic substrate smokes now prove sleep and waitFor over
  the public-ish path without LLM/provider dependency.

The remaining work is not architectural discovery. It is gap closure around
known seams.

## What Still Remains

### P0: Finish The 8-File Host-SDK Substrate Debt

The source of truth is `currentHostSdkSubstrateDebt` in `.dependency-cruiser.cjs`.
As of `7ecaa9102`, the 8 carved-out files are:

- `packages/host-sdk/src/agent-tools/execution/tool-use-to-effect.ts`
- `packages/host-sdk/src/agent-tools/execution/toolkit-layer.ts`
- `packages/host-sdk/src/host/control-request-reconciler.ts`
- `packages/host-sdk/src/host/internal/runtime-context-helpers.ts`
- `packages/host-sdk/src/host/runtime-context-workflow-core.ts`
- `packages/host-sdk/src/host/runtime-context-workflow-runtime.ts`
- `packages/host-sdk/src/host/runtime-input-deferred.ts`
- `packages/host-sdk/src/host/session-log-channel.ts`

These carveouts are the finish-line scoreboard. Do not reframe the architecture
again until this list is near zero.

Recommended split:

1. **Consumer migration / shim retirement.** Move remaining consumers off
   host-sdk re-export shims such as `runtime-context-workflow-core.ts`.
2. **Execution relocation.** Finish moving agent-tool execution mechanics from
   host-sdk into runtime-owned services.
3. **Runtime shell relocation.** Move engine lifecycle/input-deferred/control
   request mechanics below the binding line, leaving host-sdk as Layer
   composition.
4. **Immediate guardrail ratchet.** After each merge, remove the matching
   carveout and run `pnpm run lint:deps`.

Gaps acceptable for private beta: zero or one well-named compatibility shim with
no runtime behavior. Gaps not acceptable: host-sdk owning live workflow bodies,
durable substrate mechanics, or common operation execution.

### P0: Decide And Implement `session_new_all`

`docs/research/tf-lwqm-spawn-all-wiring.PROPOSAL.md` correctly identifies that
legacy `spawn_all` returns terminal artifacts, while the §6 factory flow needs
running child session handles.

Recommendation: introduce **new `session_new_all`** rather than bending
`spawn_all`.

Reasons:

- It matches the existing session-plane vocabulary (`session_new`,
  `session_prompt`, `session_close`).
- It returns running handles, which are semantically distinct from terminal
  spawn results.
- It keeps legacy `spawn_all` behavior available for historical tests or
  non-session execution if needed.

This is a P0 for private beta because it is the clean delegation primitive for
multi-agent factory behavior. It can ship with a narrow implementation focused
on local runtime contexts. Broader cancellation/cleanup polish can be P1.

### P0/P1: External Trigger Path

Runtime already owns verified webhook ingestion, and protocol now owns the
stable verified-webhook schema projection. The remaining question is the first
application binding:

```text
real webhook request
  -> runtime verified ingest
  -> durable fact / channel source
  -> host/app channel binding
  -> planner wait_for(channel)
```

Recommendation: Linear first, because it matches the factory-vision narrative.
Route installation belongs in the app or host-sdk integration layer; signature
verification and durable fact writes stay in runtime.

This can be P1 if deterministic §6 smokes remain enough for the immediate
private-beta candidate. It becomes P0 if private beta means "real external event
starts the factory" rather than "operator/test harness starts the factory."

### P1: Real Side-Effect Adapters

The next correctness frontier is not Firegrid substrate correctness; it is
world-facing effects:

- Linear issue/comment/read integration.
- GitHub PR/comment/status integration.
- Slack/human notification integration.

The architectural placement should follow the canonical firewall:

- protocol owns request/response schemas when shared;
- runtime owns execution adapters if they touch providers, credentials,
  retries, or durable side effects;
- host-sdk/app composition installs the live Layers and channel bindings.

Recommended order: GitHub or Linear first, not both. Pick the one that unlocks
the first private-beta story and keep the first adapter intentionally narrow.

### P1: Rebaseline Schema Projection

`tf-krts` was the right inventory, but the wave consumed and obsoleted several
items. Run a new schema-projection inventory against `7ecaa9102` before
dispatching more schema moves.

Private beta can ship with minor protocol projection gaps if the app/agent
surface does not expose them. It should not ship with a shape that client-sdk
and host-sdk both define separately.

### P2: Engine-Native Primitives

`streamWait`, `streamWaitAny`, and related engine primitives still look like
the right long-term substrate. They are not required to complete this private
beta if the current workflow-backed wait path remains correct and performance
is acceptable.

Keep the trigger condition concrete: open this track if measured system latency
approaches a meaningful fraction of LLM/provider network latency, or if another
workflow-body composition leak appears. Until then, do not block private beta on
engine-native primitive work.

## Recommended Sequencing To Private Beta

### Phase 1: Close Architectural Invariants

Goal: make the canonical firewall true enough that private beta bugs are product
bugs, not substrate ambiguity.

1. Finish `session_new_all` decision and first implementation.
2. Finish the highest-value `RuntimeAgentToolExecution` arms still in host-sdk.
3. Move/retire the pure re-export shims and ratchet carveouts after each move.
4. Move the control-request runtime shell below the binding line, or explicitly
   document any remaining host-sdk piece as host composition rather than
   substrate.
5. Stop when `.dependency-cruiser.cjs` has either zero carveouts or only named
   compatibility shims with no behavior.

Acceptance:

- `pnpm run verify` green.
- `pnpm run lint:deps` green with no broad carveout growth.
- `rg "@firegrid/host-sdk" packages/runtime/src` stays zero.
- `packages/runtime/src/durable-tools/` stays deleted.
- Dark-factory deterministic smoke covers sleep, waitFor, and delegation.

### Phase 2: Private-Beta Functional Loop

Goal: make one credible end-to-end factory loop work without architectural
shortcuts.

1. Choose external trigger source: recommend Linear.
2. Implement verified webhook route + channel binding in app/host integration.
3. Add one real side-effect adapter: recommend GitHub PR/comment or Linear
   comment, depending on the beta story.
4. Extend deterministic smoke before live LLM/provider smoke.
5. Run a bounded live smoke only after deterministic path is green.

Acceptable beta gaps:

- One external integration instead of all planned integrations.
- Narrow `session_new_all` semantics without full cancellation policy.
- Protocol projection backlog for surfaces not exposed to beta users.
- Engine-native primitives deferred if performance is comfortably below LLM
  latency budget.

Unacceptable beta gaps:

- Runtime imports host-sdk.
- Client-sdk imports runtime.
- durable-tools resurrection or wait-router compatibility shims.
- Host-sdk common operation execution growing new behavior.
- Agent-facing channels exposing workflow handles, execution ids, stream URLs,
  table names, or engine services.

### Phase 3: Performance And Product Hardening

Goal: convert a correct private-beta loop into a robust beta.

1. Run `pnpm --filter @firegrid/tiny-firegrid simulate:perf` after the loop is
   stable.
2. Compare Firegrid overhead to provider/LLM latency. If internal overhead is
   material, dispatch engine-native `streamWait/streamWaitAny`.
3. Add multi-run flake detection and replay artifacts for beta-critical paths.
4. Expand real adapters only after one adapter has the correct retry,
   credential, and observation model.

## What Coordinator Should Include In Their Handoff

Please fold these points into
`docs/handoffs/COORDINATOR_HANDOFF_canonical_convergence_2026-05-20.md`:

- The current convergence number should be stated as **~90-93%**, not the older
  65% from `tf-k4uo`.
- The **8-file carveout list** is now the most useful objective scoreboard.
  Future coordinators should inspect `.dependency-cruiser.cjs` first.
- PR #519 is the architectural turning point: durable-tools deletion is done.
  Do not let future work reintroduce durable-tools or wait-router compatibility
  surfaces.
- The remaining high-value work is a three-track finish:
  1. `session_new_all` / delegation;
  2. external trigger + first real side-effect adapter;
  3. carveout ratchet to zero.
- Lane D's no-ratchet finding is healthy, not a failure. It tells us the next
  reductions require consumer migration or real substrate moves, not grep-only
  cleanup.
- Private beta can tolerate narrow integration coverage and deferred
  engine-native primitives. It cannot tolerate architectural invariant
  violations.
- The next coordinator should avoid another broad SDD wave. Dispatch small
  implementation slices tied to specific files, invariants, and acceptance
  greps.

## Coordinator Dispatch Shape

Recommended next dispatches:

1. **Architect/implementation lane:** decide and implement `session_new_all`
   using `tf-lwqm` as the proposal source.
2. **Runtime boundary lane:** pick two of the 8 carveout files and move/retire
   them; update `.dependency-cruiser.cjs` in the same PR.
3. **Integration lane:** draft Linear verified-webhook trigger path and a first
   narrow adapter plan; implement only after route/channel placement is
   confirmed.

Keep one lane free for merge/rebase/guardrail repair. At this point, progress
will be constrained more by merge discipline than by lack of architectural
clarity.
