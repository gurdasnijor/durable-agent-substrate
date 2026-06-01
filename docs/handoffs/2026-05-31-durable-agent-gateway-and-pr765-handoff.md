# Handoff — Durable Agent Gateway vision + PR #765 landing

- **Date:** 2026-05-31
- **Author:** OLA2 (alignment + green-up session)
- **For:** the next agent picking up both the #765 landing and the durable-agent-gateway direction
- **Worktree:** `/Users/gnijor/gurdasnijor/firegrid-worktrees/pr765-review`, branch `sidecar/pr765-core-greenup` (off the #765 head). **Never** work in the primary checkout `/Users/gnijor/gurdasnijor/firegrid`.

## TL;DR

There are **two intertwined tracks**:

1. **Land PR #765** (the unified-kernel substrate) — a concrete, in-flight obligation. Green-up work is uncommitted on `sidecar/pr765-core-greenup`; 3 CI gates still red; an A/B/C disposition decision is pending. See prior handoff `docs/handoffs/2026-05-31-pr765-core-greenup-handoff.md`.
2. **The durable-agent-gateway vision** — captured in a new RFC this session: **`docs/rfcs/2026-05-31-firegrid-durable-acp-acpx-alignment.md`** (read it first; it's the spine of track 2).

This handoff orders **everything** by load-bearing-ness (most → least) and separates **decisions** (Gurdas's to make) from **work** (an agent can do). Track 1 must land/disposition before track 2 builds on it — but several track-2 items *are* track-1 green-up work (read-side, parent/child), so they're not fully separable.

## Artifacts produced this session

- **RFC:** `docs/rfcs/2026-05-31-firegrid-durable-acp-acpx-alignment.md` — Firegrid as a durable agent gateway; "Restate for agents" positioning; dual-role ACP gateway; separation-of-concerns; acpx adapter fleet + conformance; non-ACP feasibility (§6.5); 12 open questions.
- **This handoff.**
- Memory: `project_durable_agent_gateway_rfc.md` (+ correction to `project_acp_parent_child_output_channel_gap.md`).

---

## Open decisions (BLOCKING — Gurdas's to make), in dependency order

| # | Decision | Gates | Notes |
|---|---|---|---|
| **D1** | **#765 disposition:** A/B/C on the green-up *and* the cutover-vs-validation posture | the whole substrate (track 2 builds on it) | A = real fixes (recommended); B = rebaseline (forbidden as silent half-ship per cutover canon unless bridge-bead'd); C = stop/handoff. Separately: is #765 a real main cutover or a validation artifact? Read side is stubbed + #746/#748 regressions deleted ⇒ **green ≠ complete.** |
| ~~D2~~ | **RESOLVED — own the durable-streams core; do NOT build on Restate.** | — | Settled (not open): `forge` already explored building on Restate and abandoned it — agent-runtime integration too inflexible + operationally too complex vs a single durable-streams server. Restate stays a positioning reference only. See [[project_restate_rejected_for_agents]]. |
| **D3** | **Conformance commitment:** adopt acpx `acp-core-v1` as a *Firegrid* gate? | Direction B / agent-face completion | If yes, the ACP agent face must serve the conformant agent role; Zed external agents is the live forcing-function. |
| **D4** | **Distribution scope:** multi-node placement (HostKernelWorkflow) in v1, or single-host MVP? | distributed-graph work | Single-host is a coherent MVP; multi-node is a bigger rock. |
| **D5** | **In-process runtime backends (Q8):** may non-ACP SDKs be first-class runtime backends (no subprocess), or must everything be a subprocess behind a byte stream? | non-ACP SDK integration shape | RFC §6.5 tier 2 / §12-Q8. Downstream of the §4 refactor. |

---

## Strategic ordering — MOST → LEAST load-bearing

"Load-bearing" = how much else is blocked without it.

### Tier 0 — Decisions
D1 unblocks the substrate. (D2 is **resolved** — own the durable-streams core; do NOT build on Restate. See above.) D3–D5 can wait until their tier.

### Tier 1 — Land the substrate (#765)
1. **Green-up the 3 red gates** (effect-diagnostics, lint:dup, lint:dead) with **path-A discipline**. *Why #1:* nothing ships until #765 is green; the vision builds on this substrate. Detail + per-gate locations in the prior green-up handoff.
2. **Wire the stubbed read side** — `HostContextSnapshot`/`HostSessionSnapshot`/`HostContexts`/`SessionLifecycle` channels → real `DurableTable` reads (currently return empty, `channel-bindings.ts:448-490`). *Why high:* it's both #765 hygiene **and** vision-critical — `sessions show/history/list` (acpx/Zed parity) reads exactly these. On #765's critical path.
3. **Re-home #746/#748 regressions + verify parent/child on the unified path.** #765 deleted `wait-for-session-agent-output.test.ts` (#746) and `agent-tool-host-live.test.ts` (#748); confirm the unified path still routes `wait_for session.agent_output` for a child and admits `session_new` child-start with parent ACP runtime. Design already improved (tf-22fo `child-output-existing-channel-router`: reuse `session.agent_output` + cursor, no new channel). *Why high:* these pin merged-to-main behavior that the cutover dropped coverage for.
4. **Rearch-line reconciliation.** #765 → main deletes Shape C wholesale, abandoning the 156-commit `rearch/shape-c-cutover` line + ~9 open PRs (#757/759/761/762/764 named for closure). Disposition the closures + branches (per the transactional-cutover canon, file the remainder as blocking beads, don't close-as-superseded). *Why here:* unresolved process debt that compounds if ignored.

### Tier 2 — Keystone + clean seams
5. **`session/cancel` keystone** (RFC §7). *Why load-bearing:* one durable cancelled-terminal-state unit pays off **4 ways** — conformance MUST, the one unimplemented method on the live Zed agent face (`stdio-edge.ts:386` rejects), the client-codec gap for cancelling downstream adapters, and Restate's graceful-cancel control surface. Do early.
6. **§4 separation-of-concerns refactor** — split the adapter into substrate ⟂ ACP-gateway-edges ⟂ pluggable-runtime; replace the hardcoded codec ternary (`codec-adapter.ts:299`) with a codec/runtime **registry**; promote the orphaned `AcpStdioEdge` into `FiregridHost`. *Why load-bearing:* this single refactor is the enabler for the acpx fleet **and** non-ACP agents **and** architectural clarity. The biggest-leverage *engineering* item.

### Tier 3 — Breadth (agent ecosystem)
7. **acpx adapter fleet (downward role).** Phase 0.5 divergence spike: drive **two** real adapters (`codex-acp` + `claude-agent-acp`) through the existing codec via `FiregridHost`; **measure config-vs-code divergence** (the thesis test, not a demo). Verdict gates the registry investment → then long-tail onboarding. *Why this rank:* high value, but rides on the Tier-2 registry; spike first.
8. **ACP agent face completion + conformance gate** (Direction B). Finish `cancel`/`authenticate`/`loadSession`; adopt `acp-core-v1`; Zed external agents = live consumer. *Why after 5–6:* depends on the keystone + the promoted edge.

### Tier 4 — Agent-native roadmap (demand-sequenced, RFC §9)
9. Durable HITL timeout/escalation; agent-shaped error classification (replace pervasive `Effect.orDie`); operator console; non-ACP codecs (tiered per §6.5). *Why last:* each is additive value on a working gateway, sequenced by demand.

**Parallelizable from day 1 (decoupled):** wiring the conformance suite as a CI gate.

---

## Reusable insights (don't re-derive these)

- **Channel litmus:** a thing earns a channel only if it (1) crosses the edge to a substrate-blind remote principal, (2) names an agent-meaningful concern, (3) buys indirection, (4) carries a direction + completion contract. Inbound integration events → IngressChannel + DurableTable dedup; outbound actions → MCP tool first; convenience reads derivable from an existing stream → justify or drop.
- **Gateway inversion:** Firegrid plays *both* ACP roles — agent face (to Zed/acpx clients) + client codec (to the adapter fleet) = a durable ACP **gateway**. Zed external agents plug into the agent face; acpx adapters plug into the client face. Same gateway, two faces.
- **`session/cancel` is the keystone** (see Tier 2 #5).
- **Parent→child output is NOT an open gap** — it was fixed by #746 + #748 (merged to main 2026-05-24) and the design *improved* under #765 (tf-22fo reuses `session.agent_output` + cursor). The risk is lost *coverage* on the unified path (deleted regressions), not lost capability. (My 2026-05-21 memory calling it an open gap was stale — corrected.)
- **acpx adapters ARE ACP-agent subprocesses** (registry = `Record<name, command>`). Firegrid's `AcpSessionLive` is already an ACP client. So fleet ingestion ≈ **configuration**, not per-agent code. The per-agent long-tail cost is *dialect quirks* — harvest them from upstream/acpx; don't depend on acpx (alpha) as runtime infra.
- **Non-ACP is not an architectural change** — the codec contract `AgentSessionService` is already protocol-agnostic (`StdioJsonlSessionLive` proves it). Tiers by structure: bidirectional-wire (rich) → in-process SDK (rich, topology differs) → structured-CLI (degraded/batch) → PTY-scrape (refuse). Rides free on the §4 registry.
- **Positioning:** agent-native vertical, NOT generic durable execution. Don't out-Restate Restate; be the ACP-gateway + durable-sessions + permission-rendezvous + agent-webhooks + peer-graph edge a generic runtime leaves you to hand-roll and bare ACP can't make durable. The kernel already refuses generic-event-bus creep (`unified/README.md:36-39`).
- **#765 "green ≠ complete":** read side stubbed; schema collapse half-applied behind ~15 `as never` casts; agent face orphaned. Gates pass while functionally incomplete.

## Environment gotchas (cost real time last session)

- **Read tool intermittently HALLUCINATES file content** — trust `grep`/`sed`/`cat`/`git diff` for exact strings; verify Edit `old_string` against bash output.
- **Bash output is deferred/batched** — don't re-fire assuming failure; write to a file and read back.
- Shell **cwd resets between calls** — always `cd <abs> &&`.
- macOS has **no `timeout`**.
- Fresh worktree needs `pnpm install`.

## Key pointers

- RFC: `docs/rfcs/2026-05-31-firegrid-durable-acp-acpx-alignment.md`
- Prior green-up handoff: `docs/handoffs/2026-05-31-pr765-core-greenup-handoff.md`
- Codec seam: `packages/runtime/src/sources/codecs/contract.ts:39-59`; codec dispatch `unified/codec-adapter.ts:299`; agent face `sources/codecs/acp/stdio-edge.ts`; host `unified/host.ts:231`.
- Coordination SDD (drafted in #765 G6): `docs/sdds/SDD_FIREGRID_AGENT_COORDINATION_PATTERNS.md` — natural home to fold the gateway coordination work.
