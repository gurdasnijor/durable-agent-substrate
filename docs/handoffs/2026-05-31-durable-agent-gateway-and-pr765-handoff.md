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

---

## ⚑ Active coordination state — START HERE if you're picking up coordination across both lanes

As of 2026-05-31 there are **two live parallel agent lanes** plus a coordinator. The coordinator session is **departing**; the next agent inherits coordination duty. The lanes were dispatched from the prompts in this session and have produced cross-cutting findings that must be driven to closure.

### The lanes (cmux surface map — refs renumber across restarts; match by TITLE, re-run `cmux list-pane-surfaces`)

| Lane | cmux surface | Worktree / branch | Owns | Current state |
|---|---|---|---|---|
| **A — #765 + RFC** | `surface:24` "Review runtime architecture handoff document" | `firegrid-worktrees/pr765-review` / `sidecar/pr765-core-greenup` | #765 green-up, the **D1 memo**, and **single-writer on the RFC + this handoff** while active | Work **committed** `414052c08`; D1 memo on-branch `34aeefabb`; rec = **A + validation-posture**. Running the per-tool wiring trace + §5.5 three-column split. **MATERIAL:** parent→child `agent_output` (and spawn/spawn_all + child `wait_for`) are **UNWIRED on the unified host, not just uncovered.** |
| **B — adapter spike** | `surface:25` "Validate foreign ACP adapters on Firegrid substrate" | its **own** worktree `firegrid-worktrees/pr765-adapter-spike` / `sidecar/pr765-adapter-divergence-spike` | the divergence spike + `docs/spikes/2026-05-31-adapter-divergence-spike.md` + its own memory | Spike ran; verdict = **config-not-code (small rock)** for dialect divergence (concentrated in one registry field `newSessionMeta`). Found the §5.5 cross-cut (below). |
| **Coordinator** | `surface:6` "Review session context" | — (this session) | dispatch + routing + RFC ownership during alignment | **Departing.** Hands off to you. |

### Coordination rules (established this session — keep them)
- **Single-writer on the RFC + handoff = Lane A** while active. Lane B (and you) **never edit the RFC** — route findings to Lane A to fold in. (This coordination section is the one exception, authored by the coordinator; it is Lane-A-owned going forward.)
- **Lane B stays in its own worktree + spike doc + memory.** No shared-file collision by construction.
- **Cross-lane findings persist to `project_durable_agent_gateway_rfc.md`** (the shared index memory) so they survive even if a lane stops.
- **Routing channel:** `cmux send --surface <ref> "<msg>"` then `cmux send-key --surface <ref> Enter`, then `cmux trigger-flash --surface <ref>`.

### The live convergence you must drive to closure
The two lanes independently hit the **same object — the choreography-reach surface — from opposite ends.** Choreography-reach has **TWO axes, both must hold**:
1. **host-dispatch-wired on unified** (Lane A: spawn/spawn_all + child `wait_for` are unwired → a #765 blocking-bead);
2. **downstream-adapter MCP-surfacing reach** (Lane B: the choreography catalog reaches a downstream acpx adapter's LLM only via MCP on `session/new`, and that is **per-dialect** — claude needs the `_meta` `disableBuiltInTools`+`alwaysLoad` coax; codex defers MCP differently, **UN-RUN**).

The §6 "config not code / small-rock" fleet verdict **holds but rests on this one un-run path** — it's a *measurement gap, not an architecture gap* (the divergence lives in a single registry field).

### Open coordination action items (inherited)
1. **HOLD THE GATE:** the **MCP-surfacing follow-up spike** (attach Firegrid's MCP catalog; drive a `wait_for`/`schedule_me` choreography turn through **each** adapter; assert the tool is callable) is **APPROVED and must run BEFORE the §4 registry `newSessionMeta`/MCP-surfacing contract is frozen.** This is Lane B's next task. Don't let the registry design lock without it.
2. **Lane A pending RFC incorporation** (route/confirm): §5.5 "reach has two axes" note + §6 residual-risk line + §10 falsifier ("choreography surface reaches each dialect LLM" — still open for codex). And the **D1 blocking-bead set is now THREE**: read-side stubs, parent→child `agent_output` (unwired), and the **choreography-tool dispatch surface** (spawn/spawn_all + child/channel `wait_for`).
3. **Surface D1 to Gurdas** — the expanded blocking-bead set + the "schema-complete but partially-wired-on-unified" pattern is the key new input to the cutover-vs-validation posture (Lane A rec = A + validation-posture).
4. **Maintain single-writer discipline** and keep persisting cross-lane findings to the index memory.

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
4. **Rearch-line — MOOT (verified 2026-06-01).** Only **#765** is open; the PRs once named for closure (#757/759/761/762/764) are **already CLOSED**. There is no ~9-PR backlog (the earlier claim was stale, never verified). Residue = at most retiring a stale `rearch/shape-c-cutover` branch (trivial branch hygiene). The substantive residue (capabilities proven on now-deleted code) is **already** the read-side (#2) + parent/child (#3) beads — NOT a separate workstream. Dropped from the plan.

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
- **Parent→child output — capability/design sound, but UNWIRED on the unified path (D1-memo verified; supersedes the earlier "only lost coverage" read).** It was fixed by #746 + #748 (merged to main 2026-05-24) and the design *improved* under #765 (tf-22fo reuses `session.agent_output` + cursor — no production change needed by the *proof*). BUT tracing #765's `FiregridHost` shows the route was never composed into the unified host: no `wait_for session.agent_output` channel is bound, the tf-1ymw route (`channels/session-agent-output-route.ts`/`sessionAgentOutputObservationRoute`/`SessionSelfChannelsLive`) is **orphaned** (no prod importer reaches `unified/host.ts`), and there is **no parent→child linkage** in unified (session_new/createOrLoad/runtime-context carry only contextId/attempt/externalKey). The only read path is client-sdk `session.wait.forAgentOutput(contextId)` reading the journal, exercised solely by a protocol *schema* test. ⇒ it is **lost capability on the unified path, not merely lost coverage** — re-establishing it is Tier-2/§4 work, a #765 blocking bead, not a green-up re-home. (My 2026-05-21 memory called it an open gap; the 2026-05-31 "not a gap" correction assumed the route still existed — both now superseded by the verified unwired finding.)
- **acpx adapters ARE ACP-agent subprocesses** (registry = `Record<name, command>`). Firegrid's `AcpSessionLive` is already an ACP client. So fleet ingestion ≈ **configuration**, not per-agent code. The per-agent long-tail cost is *dialect quirks* — harvest them from upstream/acpx; don't depend on acpx (alpha) as runtime infra.
- **Non-ACP is not an architectural change** — the codec contract `AgentSessionService` is already protocol-agnostic (`StdioJsonlSessionLive` proves it). Tiers by structure: bidirectional-wire (rich) → in-process SDK (rich, topology differs) → structured-CLI (degraded/batch) → PTY-scrape (refuse). Rides free on the §4 registry.
- **Choreography-first is a load-bearing constraint (RFC §5.5):** the agent participates *with* the substrate via durable tools it calls itself — `sleep`/`wait_for`/`spawn`/`spawn_all`/`schedule_me`/`execute` (`packages/protocol/src/agent-tools/schema.ts`), canonized in `runtime-design-constraints.md:202`. The LLM owns sequencing; the substrate provides durable primitives, NOT a pre-authored workflow. Critical framing: Firegrid's workflow engine is substrate-INTERNAL durability machinery *under* these tools — the agent/developer never authors a DAG. Do NOT position Firegrid as a workflow-as-code platform. Unbuilt gaps: `event(name)` peer-pheromone + `session.self.*` interoception (substrate exists, agent-facing wrapper unbuilt).
- **Positioning:** agent-native vertical, NOT generic durable execution. Don't out-Restate Restate; be the ACP-gateway + durable-sessions + permission-rendezvous + agent-webhooks + peer-graph edge a generic runtime leaves you to hand-roll and bare ACP can't make durable. The kernel already refuses generic-event-bus creep (`unified/README.md:36-39`).
- **#765 "green ≠ complete"** (verified in the D1 memo, `docs/handoffs/2026-05-31-pr765-D1-decision-memo.md`): read side stubbed (returns empty); schema collapse half-applied behind `as never` casts (**5 introduced by the branch, not ~15**); choreography-tool dispatch surface (`spawn`/`spawn_all` + child/channel `wait_for session.agent_output`) **unwired on the unified host — not just lost coverage**; agent face orphaned. Gates pass while functionally incomplete. ⇒ **three completeness blocking beads** (read-side / parent→child agent_output / choreography dispatch) + a Shape-C process-debt bead before any main cutover; rec = **A + validation-posture.**

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
