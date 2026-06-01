# PR #765 — D1 decision memo (evidence-backed)

- **Date:** 2026-05-31
- **Author:** onboarding/green-up investigation session (read-only + WIP snapshot commit)
- **Worktree:** `firegrid-worktrees/pr765-review`, branch `sidecar/pr765-core-greenup`
- **Purpose:** give Gurdas the cheap, decision-grade evidence to make **D1** (the #765 A/B/C disposition + cutover-vs-validation posture) without an agent burning budget on premature implementation.
- **Scope discipline:** investigation only. No §4 refactor, no cutover, no big fixes implemented. The existing uncommitted green-up work was committed as a reversible WIP snapshot (`414052c08`) so the tree is clean to iterate.

---

## 1. Verified gate status (fresh run on this branch)

| Gate | Handoff said | Verified now | Where it fails |
|---|---|---|---|
| `pnpm typecheck` | green | **GREEN** (exit 0) | — |
| `pnpm test` | green | **GREEN** (15/15 turbo tasks, exit 0) | — |
| `pnpm lint` | red (effect:diagnostics) | **RED** | fails at the final `effect:diagnostics` stage; eslint + the guard scripts before it pass |
| `pnpm lint:dup` | red | **RED** | jscpd: `current=82 > threshold=0` |
| `pnpm lint:dead` | red | **RED** | knip: `current=21 > 0` |

"8 green / 3 red" confirmed. **All three red gates concentrate in the new `unified/` code** (`signal.ts`, `codec-adapter.ts`, `channel-bindings.ts`, `subscribers/*`) — none are pre-existing-elsewhere.

## 2. The 3 red gates — exact errors, path-A fix, vs what path-B buries

### 2a. `effect:diagnostics` (regression: **+2 errors, +11 warnings, +9 messages** above baseline)
Baseline (`.effect-diagnostics-baseline.json`) is `error:0, warning:10, message:72`. The gate fails on any rise above baseline.

- **2 hard errors** — `effect(missingReturnYieldStar)`, both in new unified code:
  - `packages/runtime/src/unified/signal.ts:180`
  - `packages/runtime/src/unified/subscribers/runtime-context.ts:110`
  - *Path-A fix:* change `yield*` → `return yield*` on a never-succeeding Effect. Trivial, idiomatic, zero behavior change (~10 min).
- **11 warnings** — 10× `effect(layerMergeAllWithDependencies)` in `channel-bindings.ts` `UnifiedChannelBindingsLive` (inter-layer deps inside a `Layer.mergeAll`), + 1× `globalErrorInEffectCatch` in `subscribers/scheduled-webhook-peer.ts:148`.
  - *Path-A fix:* move the dependency-providing channel layers into a `Layer.provideMerge` after the `mergeAll`; tag the webhook catch error. ~1–2h, touches binding composition only.
- **9 messages** — `unnecessaryFailYieldableError` + `preferSchemaOverJson` across `codec-adapter.ts` / `permission-and-tool.ts` / `runtime-context.ts`. Mechanical (~30 min).

**What path-B (rebaseline) would silently bury:** running `effect:diagnostics:baseline` would move the baseline to `error:2, …` — **permanently accepting 2 hard errors** plus the layer-dependency warnings. The `layerMergeAllWithDependencies` warning is not cosmetic: it warns that layers with real runtime dependencies are being built in parallel, which is exactly the kind of wiring bug that hides in a stubbed composition. Burying it is forbidden by the transactional-cutover canon.

### 2b. `lint:dup` (`current=82 > 0`, 11 clones)
All 11 clones are in new unified code; the bulk are the **read-side channel-binding boilerplate** in `channel-bindings.ts` (e.g. `265-272` vs `223-230`, `473-482` vs `456-465`) plus `codec-adapter.ts` and `signal.ts`.
- *Path-A fix:* extract the repeated channel-binding block into a helper. ~1–2h. **Note:** a chunk of this duplication IS the stubbed read-side scaffolding (§3a) — some clones will dissolve naturally when the read side is actually wired, so fixing dup in isolation may be partly throwaway.
- *Path-B (rebaseline):* `jscpd-update-baseline.mjs` raises the threshold above 82 — buries the signal that the stub scaffolding is copy-pasted.

### 2c. `lint:dead` (`current=21 > 0`)
knip findings are dominated by **exports written ahead of their consumers**: the `tiny-firegrid/src/simulations/unified-kernel-validation/{channels,signal,tables,subscribers}.ts` schema/fn exports, plus a few genuinely orphaned production files — `runtime/src/events/agent-output.ts`, `runtime/src/tables/runtime-control-plane-time.ts`, `runtime/src/channels/verified-webhook/source-live.ts` interfaces, and unused deps (`@effect/cli`, `@firegrid/client-sdk`, `@firegrid/observability` in `runtime/package.json`).
- *Path-A fix:* delete true orphans; for the sim scaffolding, either wire the consumer or scope the exports. ~1–2h. **Note:** "dead" sim exports are themselves a *green≠complete signal* — they're scaffolding for capabilities not yet wired (§3). Deleting them to make the gate green could erase work that's about to be needed.
- *Path-B (rebaseline):* `knip-update-baseline.mjs` sets `issueCount=21` — buries the orphans, including the genuinely-dead production files.

**Gate bottom line:** path-A is cheap (~½–1 day total) and almost entirely mechanical/idiomatic. The 2 hard errors especially are no-brainer real fixes. Path-B is forbidden here precisely because each gate is flagging *real* incomplete/duplicated/dead artifacts of an unfinished cutover, not noise.

## 3. Completeness gaps — "green ≠ complete" (verified)

### 3a. Read-side channels are stubbed (returning empty)
`channel-bindings.ts:448-490` — verified exact:
- `HostContextSnapshotChannelLive` / `HostSessionSnapshotChannelLive` → `Effect.succeed({ runs: [], events: [], logs: [], agentOutputs: [] })`
- `HostContextsChannelLive` / `SessionLifecycleChannelLive` → `Stream.empty`

These are advertised channels that **return empty instead of reading `DurableTable`**. They gate `sessions show / history / list` (acpx/Zed parity).
- *Work to finish:* wire snapshot-first/subscribe-after-cursor reads off `RuntimeControlPlaneTable` + `RuntimeOutputTable`. Estimate **1–3 days**.
- *Safe to ship to main stubbed?* **No — not as a silent stub.** A channel that returns `[]` is a correctness lie, not an absence. Per the transactional-cutover rule, this ships only as a **declared bridge** (owner + deletion bead + blocking dep), never as silent green.

### 3b. Deleted #746/#748 coverage + parent→child output is **UNWIRED on the unified path** (material finding)
Commit `e5ff012ab` ("phase2(3/8): cutover — delete Shape C subscribers, tables, composition, bins") deleted the **production** file `composition/agent-tool-host-live.ts` *and* both regression tests (`test/composition/agent-tool-host-live.test.ts`, `test/subscribers/tool-dispatch/wait-for-session-agent-output.test.ts`). The deleted #746 test imported from the now-deleted `src/subscribers/tool-dispatch/*` — it cannot be re-homed as-is.

Tracing the unified production path (`FiregridHost`, `host.ts`) for whether parent→child output survives — **it does not, as a wired capability:**

1. **No `wait_for session.agent_output` route is bound into `FiregridHost`.** `UnifiedChannelBindingsLive` + `UnifiedSignalingChannelBindingsLive` bind 10 + 4 channel Tags; **`SessionAgentOutputChannel` is not among them.** Output is journaled to `RuntimeOutputTable` and consumed *internally* by `JournalObserverLive` (only to trigger permission/tool sibling workflows) — there is no agent-facing observation route.
2. **The tf-1ymw / tf-22fo route is orphaned.** `channels/session-agent-output-route.ts` / `sessionAgentOutputObservationRoute` / `SessionSelfChannelsLive` have **no production importer that reaches `unified/host.ts`** (importers are all within the `channels/` cluster itself). The RFC §8 expectation ("reuse session.agent_output ingress + cursor; port-and-verify #746/#748") is **not met** — the route the RFC assumes exists is no longer composed.
3. **No parent→child linkage exists in the unified path.** `grep child|parent|parentContext|parentSession` in `unified/` → nothing. `session_new` (`HostSessionsStartChannel`), `createOrLoad`, and `RuntimeContextSessionWorkflow` carry only `sessionId`/`contextId`/`attempt`/`externalKey`. The `SessionAgentOutputChannelService.forContext` authorization resolver tf-22fo named as the parent-child boundary is not wired.
4. **The one read path that exists is client-side and unexercised end-to-end.** `client-sdk` `session.wait.forAgentOutput(contextId)` reads `RuntimeOutputTable.events.rows()` filtered by `contextId` — a journal read, not a host protocol route. It is exercised only by a *protocol schema* test (`protocol/test/session-facade/schema.test.ts`), never end-to-end against `FiregridHost`, and never for a child. No `unified-kernel-validation` scenario observes agent output through a waiter.

**Verdict (STEP 1):** parent→child output does **not** hold on the unified path. This is more than "lost coverage" (the framing in the handoff/RFC, which assumed the route still existed): the protocol-owned route is **orphaned**, the parent→child linkage/authorization is **absent**, and nothing exercises the journal-read fallback against the host. **Per mission instruction, I stopped and did not fix blind or re-home a test** — there is no wired capability to assert against. Re-establishing it is Tier-2/§4-shaped work, not a quick win.
- *Work to finish:* compose an agent-output observation route into `FiregridHost` (or wire the client journal-read path as the sanctioned surface) **+** add parent→child context linkage + the `forContext` authorization boundary **+** re-home a real regression. Estimate **multi-day**.
- *Safe to ship to main?* **No silently.** It drops merged-to-main behavior (#746/#748 landed 2026-05-24). Requires a **blocking bead** before any cutover.

### 3c. `as never` casts — 5 introduced by this branch (handoff said ~15)
11 total in `runtime/src`; **5 added by this branch** (4 in `channel-bindings.ts:142/161/216/259`, 1 elsewhere). They sit on the **stub** input-channel bindings (`HostPromptChannelLive` etc.), which use a placeholder schema (`HostContextsCreateRequestSchema as never`) and cast the whole binding `as unknown as <Channel>["Type"]`. These stubs exist only to satisfy the Tag at build time and are *overridden at runtime* by the signaling Lives (for the 4 input channels) — so individual risk is low, but they mask genuine schema mismatches and are scaffolding, not finished bindings.
- *Work to finish:* give stubs correct schemas or remove them once the real bindings exist. Coupled to §3a read-side wiring. ~½ day after that lands.

### 3e. Choreography-tool dispatch surface is unwired on the unified host (architect convergence)
The RFC's revised §5.5 elevates the agent choreography surface (`sleep`/`wait_for`/`wait_for_any`/`send`/`spawn`/`spawn_all`/`schedule_me`/`execute`) to a load-bearing constraint — the LLM owns sequencing by *calling* these durable tools. The full surface exists in schema (`agent-tools/schema.ts`) and substrate, but **choreography *reach* has two axes, both of which must hold:**

1. **Host-dispatch wired on the unified path.** What actually dispatches through `FiregridHost` today: `schedule_me`, webhook/peer `wait_for`, tool `execute`, permission. **Unwired:** `spawn` / `spawn_all` (child agent) and the child/channel `wait_for session.agent_output` route (the `unified.session.spawn` activity in `subscribers/runtime-context.ts` is the *internal* session `startOrAttach`, not the agent tool; no parent→child linkage). **Unverified:** `sleep`, generic `wait_for(channel)`, `send(channel)` egress. This is the same gap as §3b, generalized.
2. **Downstream-adapter MCP-surfacing reach.** Even host-dispatched, the catalog reaches a downstream acpx adapter's LLM only via per-dialect MCP-surfacing on `session/new` — proven for claude (`_meta` coax), **UN-RUN for codex** (spike used `mcpServers:[]`). Not a #765 gate, but a registry-contract caution: **do not freeze `newSessionMeta` until a follow-up spike drives a `wait_for`/`schedule_me` turn through each adapter.**

- *Safe to ship to main?* The unwired host-dispatch half is a **blocking-bead item** (with §3a/§3b); the downstream-reach half is a flagged residual risk, not a #765 blocker.

### 3d. Shape-C rearch-line reconciliation (process debt)
#765→main deletes Shape C wholesale, abandoning the 156-commit `rearch/shape-c-cutover` line + ~9 open PRs (#757/759/761/762/764). Per the transactional-cutover canon these closures must be dispositioned (remainder filed as blocking beads), not closed-as-superseded. Not investigated in depth this session; flagged.

---

## 4. Recommendation

**A/B/C: choose A (real fixes), with an explicit posture: land #765 as a VALIDATION / STAGING artifact, not a silent main cutover.**

Reasoning:
- **B (rebaseline) is ruled out by canon.** All three gates are flagging *real* artifacts of an unfinished cutover (2 hard errors, copy-pasted stub scaffolding, dead orphans + write-ahead exports). Rebaselining would make "green" permanently lie and bury a layer-dependency wiring warning.
- **C (stop) is unwarranted.** The investigation is decision-ready and the gate fixes are cheap.
- **A is correct *for the gates*** — the 2 errors and the messages are no-behavior-change idiomatic fixes; the dup/dead fixes are mechanical (with the caveat that some dup/dead dissolves once the read side is wired, so sequence read-side-first where practical to avoid throwaway work).

**But green ≠ ready-to-cut-over.** The cutover-vs-validation posture must be **validation artifact**, because shipping to main today would carry:
- read-side channels that return empty (§3a) — a correctness lie,
- a dropped, now-unwired parent→child output capability that was merged to main (§3b),
- the broader choreography-tool dispatch surface unwired on the unified host (§3e),
- type-unsafe stub bindings (§3c),
- an unreconciled Shape-C line (§3d, process debt).

The transactional-cutover rule forbids landing those as silent green. The honest disposition is: **path-A green-up the gates, and before any main cutover, file THREE completeness blocking beads — (i) read-side wiring (§3a), (ii) parent→child `agent_output` route + linkage (§3b), (iii) the choreography-tool dispatch surface — `spawn`/`spawn_all` + child/channel `wait_for` (§3e)** — plus a fourth **process-debt** bead for Shape-C line reconciliation (§3d), each with an owner and a deletion/closure path. (Separately, flag — not block — the downstream MCP-surfacing reach for codex per §3e axis 2; do not freeze the registry `newSessionMeta` contract until proven.) Only then does a real cutover become a transactional cutover rather than a half-ship behind a green CI badge.

### Suggested next moves (cheap, in order)
1. **Decide D1** (Gurdas): A + validation-posture, as above — or correct the frame.
2. If A: land the **2 hard `missingReturnYieldStar` errors** first (trivial, isolated, reversible) as the bounded quick win; then the messages; then warnings; then dup/dead (after deciding whether to wire read-side first so the stub dup/dead resolves naturally).
3. File the three completeness blocking beads (§3a read-side / §3b parent→child agent_output / §3e choreography-tool dispatch surface) + a Shape-C process-debt bead (§3d) before treating #765 as cutover-ready.
4. Parent→child (§3b) and the choreography-tool dispatch surface (§3e) are **not** green-up items — they're Tier-2/§4 work; do not attempt a blind re-home.

---

## Appendix — commands run (all in the worktree)
- `pnpm typecheck` → 0; `pnpm test` (bg) → 0 (15/15); `pnpm run lint|lint:dup|lint:dead` → 1/1/1.
- `pnpm knip` (human reporter) for dead-code detail.
- `git show e5ff012ab`-era deletions; `git ls-tree origin/main` vs `HEAD` for #746/#748.
- greps for `SessionAgentOutputChannel` / `sessionAgentOutputObservationRoute` / `child|parent` / `as never` (verified via grep/sed, not Read, per the hallucination caveat).
- Verification cross-checked by an `Explore` subagent trace of the unified agent-output wiring.
