# RFC: Firegrid as a Durable Agent Gateway

*Agent-native durable execution ("Restate for agents") · the dual-role ACP gateway · the acpx adapter fleet*

- **Status:** Draft / for discussion (not an approved decision)
- **Author:** OLA2 + Gurdas (alignment session, 2026-05-31)
- **Altitude:** RFC — sets direction and positioning. Each approved workstream (§11) spawns its own SDD; this stays above implementation detail.
- **Grounded against:** PR #765 unified-kernel branch (`sim/unified-kernel-validation`), worktree `firegrid-worktrees/pr765-review`. File:line citations are to that branch and were verified by a parallel grounding pass on 2026-05-31.
- **External refs:** [acpx](https://github.com/openclaw/acpx) · [acpx conformance](https://github.com/openclaw/acpx/tree/main/conformance) · [Zed external agents](https://zed.dev/docs/ai/external-agents) · [Restate guides](https://docs.restate.dev/guides) + [AI patterns](https://docs.restate.dev/ai/patterns/sessions).

---

## 1. Positioning thesis — the agent-native vertical

> **Firegrid is "Restate for agents": an agent-native specialization of durable execution, not a generic durable-execution platform.**

Restate (and Temporal) sell durable execution across four *horizontal* use-cases — workflows-as-code, async tasks/timers/schedulers, microservice orchestration, event-driven apps. Their primitives (a durable log → materialized state over RocksDB; durable promises; durable timers; per-key virtual objects) are a **commodity Firegrid should not try to out-build.**

Firegrid's defensible wedge is the layer those platforms leave as undifferentiated "write your own handler code," and that **bare ACP cannot make durable at all**: the *agent session protocol surface*. Concretely — durable agent **sessions**, the **ACP gateway** (both roles), **permission round-trips** as a durable rendezvous, verified **agent webhooks**, multi-agent **peer-event graphs**, and **agent-driven durable choreography** (`sleep`/`wait_for`/`spawn`/`schedule_me` the LLM calls itself — §5.5). A generic durable runtime makes you hand-roll every one of these; ACP gives you the wire but no durability.

**What Firegrid should deliberately NOT become** (the boundary that keeps the wedge sharp):
- A general workflow-as-code / Temporal-Restate competitor.
- A generic microservice orchestrator or saga engine.
- A generic event bus or webhook router — keep ingest narrowed to *verified agent-triggering facts*.
- A re-implementation of durable execution / timers / K/V state — those are *consumed* from the durable-streams + `@effect/workflow` core, never productized.

The unified kernel already encodes this refusal in code: the `UnifiedTable` README forbids re-introducing a generic "wait for any fact" workflow or a string-dispatch fact registry (`packages/runtime/src/unified/README.md:36-39`). That's the wedge defended at the source level.

One-line positioning: **Restate is the horizontal durable-execution substrate; Firegrid is the agent-native edge a generic runtime leaves you to hand-roll — and that bare ACP cannot make durable.**

---

## 2. Settled: own the durable-streams core (Restate is a positioning reference, not a build target)

A natural question is whether Firegrid's agent edges should be built *on* a generic durable-execution platform (Restate) rather than on the bespoke durable-streams core. **This is already settled — no.** It was empirically explored in the `forge` project and abandoned for two reasons:

1. **Inflexible agent-runtime integration.** Restate's SDK integration model (its [integration guide](https://docs.restate.dev/ai/sdk-integrations/integration-guide)) forces agent harnesses into its invocation/handler shape — a poor fit for the diverse, long-lived, stream-shaped agent runtimes Firegrid must host.
2. **Operational complexity.** Restate is heavy infra (control plane + partitioned durable log + RocksDB processors) relative to running a single durable-streams server.

So Restate stays a **positioning reference and feature checklist** (§5 maps its AI patterns to Firegrid capabilities), never a build target. Firegrid owns its durable-streams core (`DurableStream` + `DurableTable` + `@effect/workflow` + the `signal` primitive).

This *strengthens* the §1 wedge rather than weakening it: the reason an agent-native vertical exists is precisely that **generic durable execution is the wrong substrate for agent harnesses** — Restate's rigidity is empirical evidence (forge), not just a positioning preference. The structural Restate-shapedness of Firegrid's core (log → materialized state, `signal` ≈ durable promises) is a convergent-design validation, not an invitation to build on Restate.

---

## 3. The dual-role gateway (the shape)

ACP has two endpoints: a **client** (drives) and an **agent** (is driven). Firegrid plays **both**, which is what makes it a *gateway* rather than just a runtime:

```
Zed / acpx  ──ACP client──▶   FIREGRID (durable ACP gateway)   ──ACP client──▶  codex-acp / claude-agent-acp / …
 (drives)                  ┌──────────────────────────────────┐                 (ACP agents, the fleet)
                           │  agent face  · durable session ·  │
                           │  signal log  · client codec       │
                           └──────────────────────────────────┘
```

- **Upward (agent face):** Firegrid presents as an ACP agent that Zed/acpx drive — the *inversion* of the acpx model (where acpx is the client and adapters are agents). This is what `Zed external agents` plugs into (`agent_servers.<name>.{command,args,env}` — same command shape as acpx's registry).
- **Downward (client face):** Firegrid is an ACP client spawning the adapter fleet through the existing codec.

Because it sits on the wire in the middle with a durable log underneath, **a turn survives a crash and a permission request survives a disconnect** — neither of which bare ACP nor a generic runtime gives you. This delivers value to users of *either* ecosystem (Zed users get durable sessions; acpx users get a durable orchestration core under their adapters) or both at once.

---

## 3.5 The system-shape landscape — where Firegrid aligns, and the control-plane tier above it

Several adjacent systems were surveyed during this alignment. They are not competitors to pick between — they sit at **different altitudes** and mostly *stack*. Placing Firegrid in that stack is the clearest way to see where alignment is strongest and where Firegrid should refuse to grow.

```
   ▲ breadth, you-don't-operate-it
   │  Control plane / vendor-federation router        Flamecast   (HTTP runtimes, manifests, multi-tenant)
   │      — Firegrid is a RUNTIME under this, not the router
   │
   │  Unifying CLI / multiplexer (single-host)         acpx, headless-cli   (record-durable; peers/consumers)
   │  ACP client (drives a session)                    Zed external agents  (consumer of the agent face)
   │ ───────────────────────────────────────────────────────────────────────────
   │  ★ DURABLE AGENT GATEWAY (this RFC)               FIREGRID   (both ACP roles, execution-durable)
   │ ───────────────────────────────────────────────────────────────────────────
   │  Agent runtime / process                          codex-acp, claude-agent-acp; headless-coder-sdk (in-proc)
   ▼  depth, you-operate-it                            (generic durable execution: Restate — reference only, §2)
```

| System | Role / altitude | Relationship to Firegrid | Alignment strength |
|---|---|---|---|
| **Zed external agents** | ACP client | consumes Firegrid's **agent face** | **Strongest, live today** — already running; plug `FiregridHost`'s agent edge in as a Zed external agent |
| **acpx adapter fleet** | agent runtime/process | spawned by Firegrid's **client face** | **High** — breadth via config (§6); the registry is the enabler |
| **headless-coder-sdk / headless-cli** | in-proc SDK / unifying CLI | codecs (in-proc backend or shim) / a meta-adapter | **Medium** — non-ACP, rides on the §4 registry (§6.5) |
| **Flamecast** | control-plane / vendor-federation router | Firegrid is a **Runtime under it** (see below) | **High & strategically validating** — different altitude, composes vertically |
| **Restate** | generic durable execution | positioning reference only — **not** a build target (§2) | n/a (settled) |

The reusable lens: anything that **drives** a session (Zed, acpx, Flamecast) sits *above* Firegrid's agent face; anything that **is** a runtime (the adapter fleet, SDKs) sits *below* its client face; Firegrid is the durable gateway in the middle. The systems with the strongest near-term alignment are the ones already touching those two faces — Zed (above) and the acpx fleet (below).

### Flamecast: the control-plane tier above the gateway (and a roadmap boost if built on Firegrid)

Flamecast is a **runtime router + durable session plane** that federates whole agent *products* (Cursor, Devin, Jules, Think, customer-owned) as HTTP runtimes behind JSON-Schema manifests, with `engine ⟂ workload` split over HTTP. It owns durable session state, normalized events, compatibility checking, callbacks, and a durable permission-wait state machine; it explicitly **does not operate the execution substrates** — runtimes do.

**The convergence is striking and validating.** Flamecast's hardest, most valuable primitives are the ones Firegrid already implements on durable-workflow primitives — and Firegrid's are **execution-durable**, not merely record-durable:

| Flamecast primitive (PRD) | Firegrid equivalent | 
|---|---|
| Durable session log + authoritative sequence | `RuntimeOutputTable` journal + monotonic per-context sequence |
| Normalized `SessionEvent` + opaque `RuntimeSourceEvent` provenance | `AgentOutputEvent` union + codec mapping, raw retained |
| Durable `PermissionWait` SM (pending→approved/denied/expired→runtime_notified + crash reconciliation, PRD 1109–1149) | `PermissionRoundtripWorkflow` (`permission-and-tool.ts:61-153`) + `recoverPendingSignals` (`signal.ts:197-228`) — **near spec-match** |
| Standard-Webhooks at-least-once ingress + idempotency | verified-webhook HMAC ingest (`adapter.ts:206-233`) + `insertOrGet` fence |
| Rebuild/resume from accepted config | execution-durable suspend/replay (stronger than "rebuild from config") |

**Relationship — compose, don't collide.** Flamecast lives one tier *above* the gateway. Firegrid is the **best possible Flamecast Runtime**: the PRD says runtimes own the agent loop, "may use ACP internally," and own resume ("if the harness supports native resume, such as ACP `session/resume`… use the retained native session id plus durable workspace") — which is exactly Firegrid's durable ACP gateway.

**The clean composition + the roadmap boost:** Firegrid implements the **Flamecast Runtime API as an edge** (`GET /manifest`, `POST /sessions`, `POST /sessions/:id/events`, Standard-Webhooks event emission). Then:

- **Every ACP agent Firegrid hosts becomes a durable Flamecast runtime** — with execution-grade durability instead of "rebuild from config."
- Flamecast's MVP line items that are *"build it"* today collapse to *"host a Firegrid runtime"* for the ACP slice: durable session log, durable permission waits, normalized events, crash-resume — **already built, and stronger.** That's a direct short-term roadmap accelerator for a Flamecast team.
- **Flamecast keeps exactly its distinctive value** — vendor federation over HTTP, manifests, compatibility checking, multi-tenant encrypted config, and the opaque-vendor / customer-firewalled runtimes ACP can't reach. Firegrid does **not** absorb those (that breadth is where Flamecast's operational complexity is *justified*, and it's a control-plane concern, not a substrate one).

**The boundary (why Firegrid should NOT become Flamecast):** don't let "Firegrid could be Flamecast" pull the substrate up into the vendor-federation altitude. Flamecast's value (and complexity) is federating runtimes *you don't operate* over HTTP; Firegrid's is durable execution for runtimes *you do operate* via ACP. If a thin multi-runtime router is ever wanted natively, it's a **consumer/edge on Firegrid**, not a substrate feature (`feedback_firegrid_substrate_boundary`). For the ACP-shaped subset, Firegrid *removes the need* for Flamecast's multi-tier complexity entirely; for the breadth beyond ACP, Firegrid composes *under* a router. Both are wins; neither is "become the router."

## 4. Separation of concerns — the gateway framing unmuddles three tiers

The current biggest architectural debt (and the user's instinct): **#765 fuses three concerns into one in-process Layer graph.** Restate's defining move is `engine ⟂ workload ⟂ ingress` as separate deployables. The gateway framing is the agent-native version of that split.

**What's already clean:** `FiregridHost` (`unified/host.ts:231`) composes engine+tables+workflow and takes the session backend as an injected `RuntimeContextSessionAdapter` Layer (`adapter.ts:68-82`: `startOrAttach`/`send`/`deregister`). That adapter Tag is a genuine seam.

**The conflations (grounded):**

| # | Conflation | Evidence |
|---|---|---|
| 1 | The adapter muddles **process-management + protocol-codec + context-resolution** in one function body | `buildSessionForContext` resolves secrets (`codec-adapter.ts:251`), spawns the process (`:264-281`), *and* picks+builds the codec (`:299-301`) |
| 2 | Codec dispatch is a **hardcoded ternary**, not a registry | `codec-adapter.ts:299`: `agentProtocol === "raw" ? StdioJsonl… : Acp…` — the entire "agent runtime registry" |
| 3 | The ACP **agent face is orphaned** from the substrate | `AcpStdioEdge` (`stdio-edge.ts`) has zero non-test consumers; `FiregridHost` never composes it; reaches the substrate only sideways via `HostPlaneChannelRouter.dispatch` (`:280`); `cancel` (`:386`) and `authenticate` (`:257`) `reject()` |
| 4 | Gateway-protocol and runtime/process-management share one undifferentiated `sources/` tree | `AcpSessionLive` (client codec) + `LocalProcessSandboxProvider` (literal process manager — `local-process.ts:315`, `kill()` `:419`) stitched only by the adapter |

**Proposed clean layering (three orthogonal tiers):**

1. **Durable substrate** — Channel + DurableTable + Workflow + signal. Already well-factored (`host.ts:231`). Knows nothing about ACP or processes. (Restate's "engine doesn't run your code.")
2. **ACP gateway edges (both roles, symmetric, first-class)** — the agent-native analog of Restate's ingress. *Agent face* (`AcpStdioEdge`, **promoted from orphan to a composed tier of `FiregridHost`**, with `cancel`/`authenticate` wired to durable kernel signals). *Client face* (the ACP codec as a protocol adapter, **not** a process-bundling Layer). The gateway owns protocol edges + the durable session binding; it does **not** spawn processes.
3. **Pluggable agent-runtime / process-management adapter** — all of `LocalProcessSandboxProvider` + the spawn/env/lifecycle half of `buildSessionForContext`. Restate's "deployed service" tier: a swappable backend (local process, remote sandbox, persistent agent service) behind a stable contract, invoked by the substrate, blind to ACP.

**Concrete unmuddle moves:** split `ProductionCodecAdapterLive` along its own seams (`{resolve-context} ⟂ {spawn-runtime} ⟂ {bind-codec}`); replace the hardcoded codec ternary with a protocol→adapter registry (so "new runtime/protocol" = register, not patch). This is also exactly the §6 adapter-fleet enabler.

---

## 4.5 The local→remote handoff — the gateway framing is the enabler, not a retreat

A long-standing north star (the Fireline `pi-acp → openclaw` demo) is **"the same agent definition moves from laptop experiment to always-on cloud agent with a flag change — promotion, not migration."** The natural worry: if Firegrid positions as a gateway that *delegates* process spawning to a pluggable runtime tier (§4), does that move us *away* from this? **No — it is the precise mechanism that makes it possible.**

**The handoff decomposes onto the three tiers.** "Promotion not migration" literally means *swap the runtime tier while holding substrate + gateway constant*:

| Handoff element | Tier | Moves on local→cloud? |
|---|---|---|
| Durable session (conversation, approvals, events, peer board) | substrate (durable-streams) | **No** — location-independent |
| Control / middleware / observation (trace, approve, permission rendezvous) | gateway | **No** — location-independent |
| Where the process runs (local / container / cloud sandbox) | **pluggable runtime tier** | **Yes — and only this** |

This is *only possible if the runtime tier is a clean, swappable seam.* If spawning is muddled into the gateway/substrate (§4 conflations #1/#4), you cannot relocate execution without dragging the session/control plane with it — which **is** the "rebuild between phases" problem the demo fights. So the §4 separation is the enabler, full stop.

**Correct phrasing:** Firegrid does not "stop owning process management." It **owns the runtime *contract*** (`startOrAttach`/`send`/`deregister`, `adapter.ts:68-82`) **and drives it**, while pluralizing the *backends* behind it. `SandboxProviderService` is that abstraction (`name`/`capabilities`/`create`/`openBytePipe`); `LocalProcessSandboxProvider` is one backend. The handoff = recompose with a different runtime backend Layer + the **same durable-streams namespace** ⇒ session state survives *by construction* (the session is the workflow execution + signal log + journal in durable streams, not in the process). The deploy flag selects the backend; nothing else changes.

**The forcing function: "widest reach" and "seamless relocation" are the same property.** A clean runtime contract is simultaneously (a) the universal *participation* seam — any backend that satisfies it (local process, remote sandbox, always-on cloud, in-proc SDK §6.5, ACP/non-ACP codec) can run on the substrate — and (b) the *relocation* seam — the same session can move between those backends. Maximizing agent-runtime reach and enabling local→remote handoff are two views of one architectural property: **the runtime tier is pluggable, and the substrate+gateway are location-independent.** Pursuing the handoff *without compromising integrity* is therefore a forcing function for breadth: it keeps the contract honest enough that the long tail of runtimes can participate.

**Lineage / validation:** the demo's own "target architecture" pointers — Durable Subscriber (durable suspend/wake), Durable Promises (awakeable sugar), canonical `SessionId`/`RequestId`/`ToolCallId` — **are what #765 built**: the `signal` primitive is durable suspend/wake; the roundtrip keys on canonical `(contextId, permissionRequestId)` / `toolUseId`; `recoverPendingSignals` (`signal.ts:197-228`) is the crash-durable approval the demo calls "durable state." The demo even concedes its approval gated at the *prompt* layer, not the typed tool-call layer — that gap is **closed** in #765 (the roundtrip fires on the typed `PermissionRequest` observation). Firegrid is the matured substrate this north star was converging toward.

**What the dream still needs beyond #765 (by tier):**
1. **>1 runtime backend** behind the contract — `LocalProcessSandboxProvider` exists; the local→cloud handoff needs a remote/cloud backend (and the §4 refactor so it's swappable, not hardcoded). *The literal enabler.*
2. **Control-plane placement** for the always-on *fleet* (peer discovery, who-runs-where) — the `HostKernelWorkflow` / multi-node decision (**D4**). The single-session handoff does NOT need this; the fleet does.
3. **One-file deploy ergonomics** (`npx … deploy`, `secretsProxy`, control UI) — a **consumer/edge on Firegrid**, not a substrate feature (the substrate-boundary rule; same pattern as the durable-acpx edge, §11 Phase 6). The demo itself calls the remaining gaps "product and SDK gaps, not a missing-systems-foundation gap" — exactly: the foundation is the gateway; the ergonomics are a consumer.

**The one risk + guard:** this only hurts the dream if "delegate process management" is misread as "push spawn + placement decisions out to each consumer" — then every consumer re-implements local-vs-cloud and you lose "one model." Guard: **Firegrid keeps driving the runtime via the contract and composing a backend; it pluralizes backends only. Placement/lifecycle policy lives in the control-plane tier, never scattered into clients.**

## 5. Firegrid as Restate-for-agents — the five gap-fillers

For each Restate AI pattern: what Restate gives (generic), what #765 already has (grounded), and the agent-native gateway angle. **Headline: Firegrid already has structural equivalents of all five — assembled from substrate primitives, with agent-domain vocabulary Restate lacks.**

### 5.1 Durable sessions
- **Restate:** a keyed Virtual Object — per-key serialized writes, K/V `ctx.get/set("messages")`, resume by re-sending to the key.
- **Firegrid today:** `RuntimeContextSessionWorkflow` with `idempotencyKey = (contextId, attempt)` = exactly one execution per session, explicitly killing "the production TOCTOU that spawned two claude-agent-acp processes for one logical session" (`runtime-context.ts:23-25,66-71`). Conversation log = ordered durable signals replayed on restart (`signal.ts:124-164`) + journaled output sequence (`codec-adapter.ts:133-160`). Crash recovery via `Workflow.suspend`+`Effect.never` park + `recoverPendingSignals` cold-start sweep (`signal.ts:197-228`). `createOrLoad` is the resume-by-externalKey door (`session-facade/schema.ts:54-65`).
- **Agent-native angle:** the *conversation*, not the call, is the durable unit — and idempotent agent-process attach is the agent-specific failure mode Restate's generic model doesn't name.
- **Honest gap:** `loadSession` advertised **false** on the agent face (`stdio-edge.ts:238`) — resume is internal/crash-driven, not yet a client-facing reload-by-key. (The most visible parity gap vs Restate's "send a message to the same key.")

### 5.2 Human-in-the-loop
- **Restate:** one generic primitive — `awakeable` (durable promise) + `sleep` + `select` for timeout/escalation; you plumb the id and the notify/resolve glue yourself.
- **Firegrid today:** a *purpose-built* `PermissionRoundtripWorkflow` (`permission-and-tool.ts:61-153`): journals the open-request row, parks on `awaitSignal`, relays a typed `PermissionResponse` back into the session — auto-triggered on the `PermissionRequest` observation (`observers.ts:57-68`), keyed on **ACP-native** `(contextId, permissionRequestId)` so the human-UI path and the programmatic path converge on one suspended workflow without coordinating an id. Two resolution faces: forward-to-Zed-UI and `host.permissions.respond`. Invariant: ACP is always owed a response (failure → `Cancelled`, never deadlock).
- **Agent-native angle:** "many approvers, one durable rendezvous," keyed to the protocol, with loop-closure (resume the agent) part of the primitive.
- **Honest gap:** **no durable timeout/escalation on the roundtrip** — the only bound is the ACP codec edge's 20s (tf-90w5), not a durable `select(decision, sleep(3h))`. Clearest agent-native HITL feature to add.

### 5.3 Verified webhooks
- **Restate:** any handler is a webhook endpoint; persist-then-process; dedup on a *caller-supplied* idempotency key; signature verification left to handler body.
- **Firegrid today:** a first-class **verified** ingress — `ingestVerifiedWebhook` does constant-time HMAC-SHA256 verify → `payloadSha256` → `factKey=(source,deliveryId)` → `insertOrGet` primary-key fence (`adapter.ts:206-449`, `DurableTable.ts:515-559`). Crucially detects **payload divergence**: same key + different hash = typed `Conflict` (dedup generic idempotency keys can't express). Surfaces as an `IngressChannel` (`firegrid.verifiedWebhooks`) the agent waits on by `source`; secrets/headers stripped at the boundary.
- **Agent-native angle:** ACP has **no inbound-event surface** — Firegrid is the bridge that lets a Linear/GitHub/Stripe event *durably wake an agent turn* (rendezvous between external event and in-flight session), with content-hash dedup so a duplicate webhook can't re-run an expensive agent twice.
- **Honest gap:** two ingest paths exist (rich adapter vs simpler host helper without Conflict check); no TTL on the fence table. Pick the canonical path; bound growth.

### 5.4 Observability
- **Restate:** journal-as-observability; built-in UI (live invocations, step inspection, K/V view); OTel export; control (cancel/kill) coupled to the same journal. But generic — "a step is a step."
- **Firegrid today:** OTel spans baked into the **substrate primitives** with a typed `firegrid.seam.kind` + `firegrid.contract.id` taxonomy (`storage-commit`/`durable-append`/`claim-idempotency`/`storage-read`/`authority`/`process`/`transform`/…) across `DurableTable.ts` and the ACP codec — the permission handshake is a first-class `authority` seam (`acp/index.ts:568-576,770-777`). `pnpm trace:seams` (`scripts/trace-seam-coverage.ts`) fails CI if any of ~22 named architectural seams never fired — an **agent-flow conformance gate** no generic runtime ships.
- **Agent-native angle:** spans speak agent vocabulary ("stalled on a permission decision") not "step N"; observability for free at the gateway without instrumenting any agent subprocess; `contract.id` makes the trace auditable against the SDD.
- **Honest gap:** no operator-facing console (live session browser / click-to-cancel) like Restate's `:9070`; spans go to a collector only. Also: confirm trace-context is propagated across the gateway→subprocess boundary (ACP carries none).

### 5.5 Error handling / resilience
- **Restate:** transient (auto-retry+backoff) vs `TerminalError` (no retry, propagate/compensate); `ctx.run` journaled exactly-once; suspend-on-exhaustion for operator resume; per-step retry policy; idempotency keys; saga compensation.
- **Firegrid today:** exactly-once activity memoization (`activityExecute` keyed `${executionId}/${name}/${attempt}`, `engine-runtime.ts:359-366`) — every tool exec, permission write, session spawn, relay is an `Activity.make`. Worker-exclusive claim fencing (`engine-runtime.ts:63-98`). `insertOrGet` primary-key fence for stream-layer idempotency. `Workflow.idempotencyKey` at the workflow grain (`toolUseId` tool dispatch, `(contextId,attempt)` session). Suspend/resume replay re-skips journaled activities.
- **Agent-native angle:** the agent-native units — *turn, tool-call, permission decision* — already ARE the journaled, exactly-once, replayable steps, with the idempotency key falling out of the protocol (`toolUseId`), not threaded by hand.
- **Honest gap:** error *classification* is coarse — bodies use `Effect.orDie` pervasively; no transient-vs-terminal split, no per-activity `maxRetryAttempts`, no retry-then-suspend-for-operator, no compensation. Permission `Cancelled`/`Deny` is the one terminal-style outcome modeled — the template for surfacing terminal failures as typed ACP receipts.

---

## 5.5 Choreography-first: the agent participates *with* the substrate (load-bearing constraint)

A load-bearing constraint from the durable-stream-agent-platform RFC (`concepts/choreography-and-combinators.md` §6.3, canonized in `docs/cannon/architecture/runtime-design-constraints.md:202-205`) that the gateway framing must **not** lose: **the application layer is choreography-first — the LLM owns sequencing, branching, parallelism, and recovery at runtime; the substrate provides durable primitives the agent *calls*, not a pre-authored workflow.** Explicitly: *"a workflow orchestration SDK must not be the primary progress model."*

This is the **agent-as-participant** axis, distinct from the host-side durability §5 leans on: the agent itself reaches into the substrate to schedule, wait, and spawn — and every such call appends durable `suspended`/`resumed` records before it suspends or fans out, is claim-fenced, and is observable by humans *and* agents through the same stream-derived plane.

**#765 already exposes the full surface** (`packages/protocol/src/agent-tools/schema.ts`), matching the RFC's canonical tool set:

| Agent tool | Contract | Backing primitive | Status |
|---|---|---|---|
| `sleep(ms)` | durably suspend until a duration elapses | timer + signal | have |
| `wait_for(channel, match, timeout?)` | suspend until a host-declared channel row matches (snapshot-first, subscribe-after-cursor) | ingress channel + signal | have — **this is how an agent waits on an external webhook/signal** (over the verified-webhook ingress, §5.3) |
| `wait_for_any([descriptors])` | race waits over multiple ingress channels | channels + signal | have |
| `send(channel, payload)` | append to an egress channel | egress channel | have |
| `spawn(agent, prompt)` | run a child `RuntimeContextWorkflow`, await terminal | session + signal | schema+substrate; **host-dispatch UNWIRED on unified** — no agent-facing route + no parent→child linkage (see *reach has two axes* below) |
| `spawn_all(tasks)` | fan out children, await all terminal | session + signal | schema+substrate; **host-dispatch UNWIRED on unified** (same as `spawn`) |
| `schedule_me(when, prompt)` | queue a future self-prompt | timer + scheduled-prompt | have (tf-sto7 true-future durable delivery) |
| `execute(sandbox, input)` | execute against a sandbox/tool target | sandbox + tools | have |

So agent self-scheduling, waiting on webhooks/signals, and spawning children are **first-class substrate participation, not gateway add-ons.**

**Resolving the apparent tension with "Firegrid leans on workflows."** §5 and the gateway framing lean heavily on the workflow engine (`RuntimeContextSessionWorkflow`, `PermissionRoundtripWorkflow`). That does **not** make Firegrid a workflow-as-code platform, and the distinction is load-bearing: **the workflow engine is substrate-internal durability machinery *under* the choreography tools — the agent (and the developer) never authors a DAG, step function, or YAML workflow.** The agent calls `wait_for`/`sleep`/`spawn`; the engine makes those calls durable/replayable/exactly-once underneath. This is the same §1 "NOT a workflow-as-code platform" wedge and the `unified/README.md` refusal of generic-fact workflows, restated as the choreography constraint: Firegrid MUST NOT require, and MUST NOT primarily expose, a workflow-orchestration SDK for agent progress.

**Adjacent §6.2 constraints — coverage check:**
- *Streams-as-truth / claim-first / restart-safe replay* → covered by §5's durability mechanics (journal source-of-truth, `insertOrGet`/`claimActivity` fences, `recoverPendingSignals`).
- *No-in-memory-waiter* (`runtime-design-constraints.md:346` — a wait "must not require an in-memory waiter to have survived") → satisfied: waits are durable signal rows resumed on replay, not live fibers. This is also **why the local→remote handoff (§4.5) works** — a relocated session reconstructs its waits from records.
- *Live-promptability gate* ("a durable session id does not prove the runtime owns a live promptable session") → handled via the adapter's idempotent `startOrAttach` + host-process registry; **directly relevant to relocation (§4.5)** — the new runtime must *establish* live promptability, not assume the durable id grants it.
- *Component combinator algebra / middleware-as-serializable-topology* (trace/approve/budget/peer as combinators over the Harness; "durable topology is data") → an **application-layer/SDK concern that lives in a consumer** (the Fireline-style `agent.ts`), not the substrate — consistent with the boundary rule. The substrate must keep topology expressible as durable data, not runtime closures.

**Choreography *reach* has two axes — both must hold, and the "have" column above means *schema + substrate exist*, not *reaches the LLM on #765*.** Two parallel sessions converged on this from opposite ends:

1. **Host-dispatch wired on the unified path** (does `FiregridHost` actually dispatch the tool to the substrate?). *Verified gap (session 1):* `spawn` / `spawn_all` (child agent) and the child/channel `wait_for session.agent_output` route are **unwired on the unified host** — schema + substrate exist, but no agent-facing observation route is composed into `FiregridHost` and there is **no parent→child linkage** (the `unified.session.spawn` activity name in `subscribers/runtime-context.ts` is the *internal* session `startOrAttach`, not the agent tool). Dispatch-wired on unified: `schedule_me` (`ScheduledPromptWorkflow`), webhook/peer `wait_for` (observers + `awaitSignal`), tool `execute`, permission. Not yet confirmed on unified: `sleep`, generic `wait_for(channel)`, `send(channel)` egress. ⇒ a #765 blocking-bead item (see the D1 memo completeness set).
2. **Downstream-adapter MCP-surfacing reach** (even when host-dispatched, does the catalog reach a *downstream acpx adapter's* LLM?). The choreography tools reach a downstream adapter only by being surfaced as MCP tools on `session/new`, and that path is **per-dialect**: claude needs the `_meta` `disableBuiltInTools` + `alwaysLoad` coax (the Claude SDK defers MCP behind ToolSearch); codex defers MCP by a *different* mechanism and the surfacing turn is **UN-RUN** (the divergence spike drove its turn with `mcpServers:[]`). ⇒ "does Firegrid's choreography surface reach this adapter's LLM" is **unproven for codex**.

Both axes must hold for an agent to actually *use* the surface end-to-end. "Have" in the table is the primitive existing, not an LLM reaching it on #765.

**Known choreography gaps (from `docs/cannon/sdds/SDD_FIREGRID_AGENT_BODY_PLAN.md`):** the inter-agent **`event(name)` peer-pheromone channel** (the choreography thesis's strongest case) and **`session.self.lifecycle` / `session.self.checkpoint` interoception** are not yet exposed agent-facing — the substrate exists (peer-events board, `CallerFact` streams) but the agent-facing channel wrappers are unbuilt. These are the highest-leverage *additions* to the choreography surface and belong on the agent-native roadmap (§9).

## 6. The acpx adapter fleet (downward role) + conformance

(From the prior alignment; unchanged in substance, now framed as the gateway's *client* face.)

**The realization:** acpx adapters are just ACP-agent subprocesses (registry = `Record<name, command>`, e.g. `codex` → `npx -y @agentclientprotocol/codex-acp`). Firegrid's `AcpSessionLive` is already an ACP client. So ingesting the fleet ≈ **configuration**, not per-agent integration — and the enabler is exactly the §4 codec-ternary → registry change.

**Important nuance — what "adopt acpx" means (don't conflate):**
- The agent *packages* (codex-acp, claude-agent-acp) are upstream of acpx → consume directly (the breadth win).
- acpx's *curation + dialect-quirk knowledge* → mine as reference/data; vendor it.
- acpx *as a runtime dependency* → **don't** (it's alpha; couples Firegrid's stability for no substrate gain).

**Where the long-tail cost actually lives:** per-agent ACP **dialect quirks** (handshake `_meta`, capability negotiation, tool-mode, cancellation). That's the only cost that scales with N — and harvesting outsources it to the parties closest to each agent. The conformance suite is what keeps that maintenance bounded.

**Conformance (`acp-core-v1`)** tests the **agent role** (initialize / session/new / session/prompt / session/update / session/cancel + error semantics; `session/cancel` MUST → cancelled terminal state). Two uses: validate the adapters we drive (Direction-A dependency check); and — the load-bearing one — **gate Firegrid's own agent face** (Direction B). Zed external agents is a *conformance forcing-function with a UI* (but Zed's own dialect — MCP forwarding, model/mode — means conformance-green ≠ Zed-green; need both).

**Residual risk — "config not code" holds, but rests on one un-run MCP-surfacing path.** The divergence spike proved fleet onboarding ≈ *configuration*: codex-acp + claude-agent-acp both ran a full turn through the **unmodified** codec, and the only per-dialect *code* is the claude `session/new._meta` (which codex received and ignored). That verdict **holds** — but its choreography-reach half rests on a single un-run path (§5.5 axis 2): the spike drove its turn with `mcpServers:[]`, so no adapter has been shown to actually expose Firegrid's `wait_for`/`schedule_me`/`spawn` catalog to its LLM. The per-dialect divergence is concentrated in one registry field (`newSessionMeta` / MCP-surfacing), so this is a *measurement* gap, not an architecture gap — **but do NOT freeze the registry `newSessionMeta` contract until a follow-up spike drives a `wait_for`/`schedule_me` turn through each adapter and asserts the LLM can call the tool.**

---

## 6.5 Beyond ACP — feasibility of non-ACP agents

**Verdict: feasible, and not an architectural change.** The codec contract `AgentSessionService` (`meta`/`toolUseMode`/`send`/`outputs` over a byte stream, `sources/codecs/contract.ts:39-59`) is *already* the protocol-agnostic generalization point, and a non-ACP codec already ships — `StdioJsonlSessionLive` (raw JSON-lines). ACP is one codec; raw-jsonl is another. What varies between agent ecosystems is **integration topology**, and that is exactly what the §4 pluggable-runtime + codec-registry refactor is built to absorb. **ACP stays the "safe bet"** because it is the only tier that fully exercises the durable gateway's agent-native features (mid-turn permission rendezvous, streaming output cursors, exactly-once tool dispatch).

**Integration tiers, by descending richness/cleanliness:**

1. **Structured bidirectional wire protocol over a subprocess** (ACP, stdio-jsonl). Existing codecs. Full gateway value — the agent is a long-lived process speaking typed frames both ways, so HITL/streaming/tool-dispatch all engage.
2. **In-process structured SDK** — e.g. [`headless-coder-sdk`](https://github.com/OhadAssulin/headless-coder-sdk) (TS library wrapping Codex/Claude/Gemini). Its `runStreamed()` typed events `{type, role, delta, text}` + `startThread`/`resumeThread` + structured-output schemas + MCP tools + `AbortSignal` map ~1:1 onto Firegrid's `AgentOutputEvent`/`AgentInputEvent` and session lifecycle (`thread` ≈ session, `resumeThread` ≈ `createOrLoad`). Semantically rich; *topology* differs — it's a library, not a subprocess. Two paths: **(a)** wrap it behind a thin stdio shim binary → reuse the existing codec + process tier unchanged; **(b)** an in-process codec that produces an `AgentSessionService` *without spawning a process* — clean **iff** §4.3's runtime tier admits in-process backends (an SDK is then just another runtime backend, no sandbox).
3. **Structured CLI / one-shot** — e.g. [`headless-cli`](https://github.com/RobertTLange/headless-cli) (`headless <agent> --prompt … --json`). Feasible but **degraded**: a CLI invocation is request/response or `--session`-resumable, *not* a live duplex stream, so it cannot participate in mid-turn permission round-trips or streaming. You get durability of the *turn*, not the interactive gateway features. A batch tier. (Note: `headless-cli` is itself a unifying CLI over agents — a peer to acpx — and already supports ACP + `--json`; Firegrid could spawn it as a downstream *meta-adapter* to harvest many agents at this degraded tier in one integration.)
4. **PTY / character-scraping** — the brittleness ACP exists to escape. Neither repo does this. Firegrid should **refuse** to build a scraping codec.

**Why ACP is still the safe bet:** only tiers 1–2 fully engage the durable gateway's agent-native value (permission rendezvous, streaming cursors, exactly-once tool dispatch). Tier-3 agents are durable-at-the-turn but blind to the interactive features. So target ACP first; treat non-ACP as **codecs that ride for nearly free on the §4 refactor**, tiered by how much structure the agent exposes.

**Free-rider point:** non-ACP support needs no work beyond §4 (codec registry + pluggable runtime tier) plus one codec per integration shape. It is **not a separate big rock** — it is the same seam generalization the acpx fleet already requires. This is a strong independent reason to do §4 well.

## 7. The `session/cancel` keystone

One unit of work pays off in **four** places, so it's the highest-leverage item across this whole RFC:

1. Conformance MUST (agent role): active turn → **cancelled terminal state**.
2. The one unimplemented method on the live Zed agent face (`stdio-edge.ts:386` `reject()`).
3. The gap on the client codec for cleanly cancelling downstream adapters.
4. Restate's "graceful cancel + compensation" control surface — the agent-native version.

And "cancelled **terminal state**" is durability-shaped (a durable run-lifecycle row, not a synthesized edge signal — the C7 constraint). Build it once, durably, on the kernel; wire both ACP faces to it. **Do it early.**

---

## 8. Channel / boundary discipline (carry-over)

The channel litmus (earns a channel only if it crosses the edge to a substrate-blind remote principal, names an agent-meaningful concern, buys indirection, carries a direction + completion contract):

- **Inbound integration events** (webhooks, peer events) → `IngressChannel` backed by `DurableTable` + primary-key dedup. Canonical (§5.3 is the worked example).
- **Outbound actions** (send message/post) → MCP tool first; channel only on the crash-durability test.
- **Child output** → reuse existing `session.agent_output` ingress + cursor (tf-22fo proved it); do **not** mint `session.child.output`. Port-and-verify #746/#748 on the unified path; re-home the two deleted regressions.
- **Snapshots** → suspect as a third read shape; justify on ergonomics or derive from the events fold — either way finish the stubbed host-side table read (it's on #765's critical path and gates `sessions show/history`).
- Agent never sees substrate strings.

---

## 9. Honest gaps to close (the agent-native roadmap)

Recurring across dimensions — these are the *agent-native features* that turn "structural parity" into "better than generic for agents":

1. **Durable HITL timeout/escalation** — race `awaitSignal` against `Workflow.sleep` on the permission roundtrip → auto-deny / notify-on-stall / escalate-to-second-approver, surviving restart.
2. **Agent-shaped error classification** — transient (bounded retry-then-suspend-for-operator) vs terminal (typed ACP receipt) instead of pervasive `Effect.orDie`.
3. **Client-facing session reload-by-externalKey** — flip `loadSession` from false; expose Restate's "resume by key."
4. **Operator console** — live session browser keyed by the seam taxonomy + click-to-cancel (built on the spans + cancel keystone that already exist).
5. **Cross-boundary trace propagation** — inject/extract `traceparent` across the gateway→subprocess ACP boundary.

Each is a substrate/edge feature, not ergonomics — they belong in the gateway.

---

## 10. Risks & falsifiers

- **Bespoke-core maintenance** — owning the durable-streams core is a real ongoing cost. *Mitigation (settled, not open):* Restate was empirically worse for agents in `forge` (inflexible integration + ops complexity), so the cost is justified; the single-durable-streams-server footprint is the operational simplicity dividend.
- **ACP dialect drift** — "ACP" varies per adapter. *Falsifier:* per-adapter conformance pass; registry records quirks.
- **`provider_executed` vs `observation_only` tool modes** — changes permission/tool wiring. *Falsifier:* tool-dispatch test per mode.
- **Cancellation semantics** — conformance needs a cancelled *terminal state*; today scope-close. *Falsifier:* `session/cancel` case green with an observable cancelled row.
- **#765 cutover incompleteness** — read-side stubs + deleted #746/#748 regressions + the **choreography-tool dispatch surface (`spawn`/`spawn_all` + child/channel `wait_for`) unwired on the unified host** ⇒ green ≠ complete. *Falsifier:* read-side returns real rows; re-homed regressions pass on the unified path; an agent-driven `spawn`/`wait_for` turn dispatches through `FiregridHost`.
- **Choreography surface reaches each dialect LLM** — the agent-tool catalog reaches a downstream adapter's LLM only via per-dialect MCP-surfacing on `session/new`; proven for claude (`_meta` coax), **still open for codex** (un-run; the spike used `mcpServers:[]`). *Falsifier:* drive a `wait_for`/`schedule_me` turn through each adapter with the Firegrid MCP catalog attached and assert the LLM calls the tool — before freezing the registry `newSessionMeta` contract.
- **Boundary erosion** — durable-acpx work adding CLI/flows/config to core. *Falsifier:* every ergonomics feature lands in a consumer pkg.
- **Agent-face orphan** — `AcpStdioEdge` has no production consumer on #765. *Falsifier:* an `apps/` binary composes it, or it's explicitly unshipped.

---

## 11. Phased plan (each phase → its own SDD on approval)

- **Phase 0 — Adapter divergence spike (tiny-firegrid).** Drive *two* real adapters (`codex-acp` + `claude-agent-acp`) through the existing codec via `FiregridHost`; **measure config-vs-code divergence** (the §6 thesis test). Verdict gates the registry investment. (The build-on-Restate question is settled — §2 — so this is the real first spike.)
- **Phase 1 — Separation-of-concerns refactor (SDD).** Split the adapter into substrate ⟂ gateway-edges ⟂ pluggable-runtime; codec ternary → registry. Enables both the fleet and architectural clarity.
- **Phase 2 — `session/cancel` keystone (SDD).** Durable cancelled-terminal-state; wire both ACP faces.
- **Phase 3 — Promote + complete the ACP agent face (SDD).** Re-home `AcpStdioEdge` into `FiregridHost`; finish `cancel`/`authenticate`/`loadSession`; adopt `acp-core-v1` as a CI gate. (Direction B; pairs with Zed external agents as the live consumer.)
- **Phase 4 — Read-side wiring (folds into #765 green-up).** Snapshot/lifecycle channels → real reads; re-home #746/#748; parent/child verify. Unblocks `sessions show/history`.
- **Phase 5 — Agent-native roadmap (§9).** Durable HITL escalation, error classification, operator console — sequenced by demand.
- **Phase 6 — Durable-acpx edge (separate product/repo).** CLI/flows/inspection as a *consumer* of the substrate. Outside the boundary by design.

Conformance suite wiring can run in parallel from the start (decoupled, useful regardless).

---

## 12. Open questions (the decisions this RFC can't make for you)

1. **(Q1 — RESOLVED) Own the durable-streams core; do NOT build on Restate.** Settled via the `forge` exploration (inflexible agent-runtime integration + operational complexity). Restate is a positioning reference only (§2). Kept here only to mark it closed.
2. **Conformance role:** adopt `acp-core-v1` only as a dependency check, or commit to it as a *Firegrid* gate? (Decides if Direction B / Phase 3 is in scope.)
3. **Distribution:** is multi-node placement (`HostKernelWorkflow`) in the v1 vision, or is single-host durable-agent-gateway the MVP?
4. **Runtime boundary:** is the pluggable-runtime tier (§4.3) a true out-of-process boundary (remote sandbox/persistent agent service), or just a clean in-process Tag boundary? (Decides whether it needs a wire protocol.)
5. **Two dispatch keys or one:** should "agent protocol" (ACP vs raw) and "runtime/process backend" be independent registries, or is `agentProtocol` the single key? (§4.)
6. **acpx coupling:** vendor adapter commands + quirk data, or depend on acpx upstream? (Drift vs reuse.)
7. **Deleted-code coverage (NOT a PR backlog):** capabilities here (parent/child, read-side) were proven on code #765's deletion removed; re-home their coverage before building forward (= the read-side + parent/child completeness items). There is **no open-PR backlog** to reconcile — only #765 is open; #757/759/761/762/764 are already closed (corrected 2026-06-01).
8. **In-process runtime backends:** should §4.3's runtime tier admit in-process SDK agents (e.g. `headless-coder-sdk`) as first-class — producing an `AgentSessionService` with no subprocess — or require every agent to be a subprocess behind a byte stream (shim the SDK)? (§6.5 tier 2.) Decides whether non-ACP SDKs integrate in-process or via a stdio shim.
9. **Local→remote relocation semantics (§4.5):** is the handoff *restart-attach* against a shared durable-streams namespace (process dies here, re-spawns there, re-attaches via `createOrLoad` + `recoverPendingSignals`), or does any use case need *live* session migration? And is runtime-backend selection a deploy-time composition choice or a runtime placement decision owned by the control plane (ties to **D4**)?
10. **Choreography surface completion (§5.5):** prioritize the unbuilt agent-facing primitives — `event(name)` peer-pheromone (the strongest inter-agent-coordination case) and `session.self.*` interoception. Both have substrate but no agent-facing channel wrapper. Which lands first, and does `event(name)` reshape `CallerFact` streams or get a dedicated typed event channel (avoid substrate leak)?
