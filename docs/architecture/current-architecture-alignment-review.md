# Current Architecture Alignment Review

Date: 2026-05-10

Branch: `firegrid/durable-streams-boundary-hardening`

Base: `8bceee9` (`origin/main`, after architecture stabilization blockers)

## Executive Summary

- Firegrid's current package graph is materially cleaner than the early tracer
  baseline: Durable Streams substrate code is in `@firegrid/durable-streams`,
  sandbox execution has moved to `@firegrid/sandboxes-core` and
  `@firegrid/sandbox-local-process`, and runtime workflows consume those
  boundaries through Effect Layers.
- The main package dependency direction is now healthy for Firegrid packages:
  `@firegrid/protocol` depends only on `effect`; `@firegrid/client` does not
  depend on `@firegrid/runtime`; `@firegrid/runtime` does not depend on
  `@firegrid/client`; reusable packages do not import apps. This supports
  `firegrid-architecture-boundary.DEPENDENCY_GRAPH.1`,
  `firegrid-architecture-boundary.DEPENDENCY_GRAPH.2`,
  `firegrid-architecture-boundary.DEPENDENCY_GRAPH.3`, and
  `firegrid-architecture-boundary.DEPENDENCY_GRAPH.6`.
- Stabilization Lane A hardened the Durable Streams boundary after tracer 005:
  `@firegrid/durable-streams` now exposes narrow `./log`, `./state`,
  `./producer`, and `./workflow-engine` subpaths; `@firegrid/client` imports
  only browser-safe subpaths; and `packages/**`, `apps/**`, and `scenarios/**`
  no longer import `@durable-streams/*` directly.
- Tracer 006 created the production runtime host root at
  `packages/runtime/src/runtime-host/index.ts`. Scenarios now configure
  `FiregridRuntimeHostLive` instead of owning the runtime context Layer graph.
- Tracer 007 extracted the sandbox slot and fixed the recent `CommandExecutor`
  leak: `@firegrid/sandboxes-core` is provider-neutral and independent of
  `@effect/platform`; local process owns the Effect Platform dependency.
- Tracer 008 and tracer 011 improved materialization by defining a common
  strategy vocabulary and moving projection target schema/query ownership into
  target descriptors. This satisfies the direction of
  `firegrid-materialization-engines.ENGINE.4`,
  `firegrid-materialization-engines.ENGINE.5`, and
  `firegrid-materialization-engines.ENGINE.7`.
- Materialization remains staged under
  `@firegrid/runtime/data-plane/materialization/*`. This is documented tracer
  debt rather than an accidental package split, but the public subpath names are
  stale relative to the current target package model.
- Tracer 009 added a durable required-action workflow. Its core semantics are
  right for `firegrid-required-actions.WORKFLOW.1` through
  `firegrid-required-actions.WORKFLOW.5`, but it intentionally uses raw
  retained required-action facts in runtime-local schemas. Protocol ownership
  and State Protocol descriptors are a known follow-up gap.
- Agent ingress is still not implemented. Firegrid has durable runtime output
  but no durable, provider-neutral runtime input model yet. This is the main
  expected gap before real ACP/Claude/provider work.
- The previous highest-priority actual risk, `@firegrid/client` reaching the
  broad `@firegrid/durable-streams` root export, is resolved by narrow subpath
  imports and dependency-cruiser guardrails for
  `firegrid-platform-invariants.LOCALITY.2`,
  `firegrid-platform-invariants.LOCALITY.7`,
  `firegrid-architecture-boundary.DEPENDENCY_GRAPH.7`, and
  `firegrid-architecture-boundary.DEPENDENCY_GRAPH.8`.

These remaining items are not ordinary follow-up items. They are tracer-freeze
blockers for the next wave unless the target architecture consciously accepts
them:

1. Decide whether required-action state is raw retained facts for the medium
   term or should move into `@firegrid/protocol` descriptors plus
   `@firegrid/durable-streams` State Protocol adaptation before agent ingress
   and workflow-backed tools build on it.
2. Add a tracer-008-specific scenario proof, or explicitly map tracer 002 and
   tracer 011 scenarios to tracer 008 acceptance. Today there is no
   `scenarios/firegrid/src/tracer-008.test.ts`.
3. Decide the next materialization namespace step: keep
   `@firegrid/runtime/data-plane/materialization/*` as staged public API and
   document it, or extract a dedicated `@firegrid/materialization` package.
4. Run tracer 012 before real runtime adapters. Without durable agent ingress,
   provider input will drift into command argv, stdin fixtures, or product
   protocol shortcuts.

## Tracer Freeze / Blockers

Further feature tracers should pause until the remaining blockers are resolved
or explicitly accepted in the target architecture. Stabilization Lane A resolves
the Durable Streams substrate/browser-boundary blockers; the unresolved
blockers below would still cause the next tracer wave to build permanent API,
package, or durable schema dependencies on unsettled boundaries.

| Blocker | Category | Blocks | Required decision or fix |
| --- | --- | --- | --- |
| Required-action durable schema/state ownership is runtime-local while ingress/tools are about to build on it. | Needs Decision / Blocker | Tracer 012 agent ingress and tracer 010 workflow-backed tools. | Decide whether required-action records move to `@firegrid/protocol` descriptors, remain runtime-local, or gain a projection target. |
| Materialization lives under stale `@firegrid/runtime/data-plane/materialization/*` paths while becoming a core pluggable runtime-host strategy. | Needs Decision / Blocker | Materialize strategy tracer, runtime-host config work, future projection target packages. | Decide package/subpath/root ownership before adding more materialization production surfaces. |
| Tracer 008 lacks a direct scenario E2E or explicit spec-approved coverage mapping. | Actual Deviation / Blocker | Future materialization strategy work and scenario coverage policy. | Add `tracer-008.test.ts` or document accepted coverage through tracer 002/011 in the tracer/spec. |

## Current Physical Architecture

### Packages And Apps

| Package or app | Current responsibility | Important exports | Current dependency notes |
| --- | --- | --- | --- |
| `@firegrid/protocol` | Browser-safe schemas, helpers, cursors, and State Protocol descriptors for launch/runtime context and session projection targets. | `.`, `./launch`, `./session` | Depends only on `effect`; aligned shared base. |
| `@firegrid/durable-streams` | Durable Streams substrate adapters: workflow engine, retained log helpers, idempotent producer, StreamDB state schema adaptation, test utilities. | `.`, `./log`, `./state`, `./producer`, `./workflow-engine`, `./test-utils` | Owns all direct `@durable-streams/*` imports. Browser/client consumers use narrow subpaths, not the broad root. |
| `@firegrid/client` | Browser/app-facing launch and observation surface. Normalizes public launch input and reads retained snapshots. | `.` | Depends on `@firegrid/durable-streams/log`, `@firegrid/durable-streams/state`, and `@firegrid/protocol`; no runtime edge and no durable-streams root import. |
| `@firegrid/runtime` | Node-tier runtime host, runtime context workflow, runtime output writer, materialization staging area, required-action workflow. | `.`, `./required-action`, `./data-plane/materialization`, `./data-plane/materialization/core`, `./data-plane/materialization/raw-fold`, `./data-plane/materialization/state-protocol`, `./data-plane/materialization/materialize` | Depends on Durable Streams, protocol, sandbox packages, Effect Platform, Workflow, SQL. No client edge. |
| `@firegrid/sandboxes-core` | Provider-neutral sandbox contract and types. | `.` | Depends only on `effect`; aligned after tracer 007 boundary fix. |
| `@firegrid/sandbox-local-process` | First sandbox provider implementation using Effect Platform local process execution. | `.` | Owns `@effect/platform`; depends on `@firegrid/sandboxes-core`. |
| `@firegrid/scenario-firegrid` | Scenario-level E2E proofs for implemented tracers. | No public package exports. | Depends on client, runtime, protocol, durable-streams. |
| `apps/flamecast` | Legacy/example app using Firegrid Durable Streams wrappers and Firegrid-adjacent runtime code. | App, no package exports. | Uses `@firegrid/durable-streams/*` subpaths rather than direct `@durable-streams/*` imports. |

### Generated Graph Artifacts

Regenerated graph assets in this PR:

- [docs/dependency-graph.mmd](../dependency-graph.mmd)
- [docs/dependency-graph-detail.mmd](../dependency-graph-detail.mmd)
- [docs/dependency-graph-client.mmd](../dependency-graph-client.mmd)
- [docs/dependency-graph-protocol.mmd](../dependency-graph-protocol.mmd)
- [docs/dependency-graph-runtime.mmd](../dependency-graph-runtime.mmd)
- [docs/dependency-graph-runtime-detail.mmd](../dependency-graph-runtime-detail.mmd)
- [docs/dependency-graph-runtime-control-data-detail.mmd](../dependency-graph-runtime-control-data-detail.mmd)
- [docs/dependency-graph-flamecast.mmd](../dependency-graph-flamecast.mmd)
- [docs/dependency-graph-flamecast-detail.mmd](../dependency-graph-flamecast-detail.mmd)

Graph reading summary:

- The workspace graph is acyclic and dependency-cruiser reports no violations.
- `@firegrid/protocol` is a low-level shared dependency and does not import
  client/runtime.
- `@firegrid/runtime` imports `@firegrid/sandboxes-core` and
  `@firegrid/sandbox-local-process` only through the host/runtime context path,
  which is the intended post-tracer-007 shape.
- The client graph now shows `packages/client/src/firegrid.ts` importing only
  `@firegrid/durable-streams/log` and `@firegrid/durable-streams/state`.
  Workflow-engine, producer, server, and test utility substrate modules are no
  longer reachable from production client code.
- The runtime detail graph shows expected internal coupling between
  `control-plane/runtime-context/workflow.ts`,
  `data-plane/runtime-output/writer.ts`, and `runtime-host/index.ts`.
- The runtime control/data graph remains useful but increasingly stale in
  naming: materialization is still physically under `data-plane`, while
  required actions are now a sibling runtime namespace.
- The Flamecast graph no longer shows direct app imports of
  `@durable-streams/client`, `@durable-streams/server`, or
  `@durable-streams/state`; it uses Firegrid Durable Streams subpaths.

### Surprising Edges And Direction Issues

1. Scenario imports of `@firegrid/runtime/data-plane/materialization`:
   - Files: `scenarios/firegrid/src/tracer-002.test.ts`,
     `scenarios/firegrid/src/tracer-011.test.ts`.
   - Why surprising: scenarios use a stale `data-plane` runtime subpath for
     materialization. This is currently a declared staging path, not hidden
     source wiring.

2. `@firegrid/durable-streams` broad root remains available:
   - Files: `packages/durable-streams/src/index.ts`,
     `packages/durable-streams/package.json`.
   - Why surprising: the root is still broad for Node-tier convenience, but
     browser/client consumers are now mechanically guarded away from it.
   - Spec pressure: `firegrid-architecture-boundary.SURFACE_AREA.3`.

## Current Logical Architecture

### Runtime Host Root

Production-like host wiring lives in
`packages/runtime/src/runtime-host/index.ts`.

`FiregridRuntimeHostLive` owns:

- workflow stream topology via `DurableStreamsWorkflowEngine.layer(...)`;
- runtime control-plane stream via `RuntimeControlPlaneLive(...)`;
- runtime-output data-plane stream via `RuntimeCaptureJournalLive(...)`;
- local-process sandbox provider wiring via
  `LocalProcessSandboxProvider.layer()`;
- Node platform provision via `NodeContext.layer`.

This aligns with:

- `firegrid-durable-launch-runtime-operator.RUNTIME_HOST.1`
- `firegrid-durable-launch-runtime-operator.RUNTIME_HOST.2`
- `firegrid-durable-launch-runtime-operator.RUNTIME_HOST.3`
- `firegrid-durable-launch-runtime-operator.RUNTIME_HOST.4`
- `firegrid-platform-invariants.PRODUCTION_SURFACE.3`
- `firegrid-platform-invariants.PRODUCTION_SURFACE.4`

Current gap: the host root does not yet own materialization strategy, required
action topology, or agent ingress topology. Those are either staged under
separate production surfaces or not implemented.

### Durable Streams Substrate

`@firegrid/durable-streams` owns:

- direct imports from `@durable-streams/client`;
- direct imports from `@durable-streams/state`;
- direct imports from `@durable-streams/server` in test utility code;
- Durable Streams workflow engine implementation;
- retained JSON stream helpers;
- idempotent producer wrapper;
- adaptation from protocol descriptors to StreamDB state schemas.

This is aligned with tracer 005 and
`firegrid-architecture-boundary.AUTHORITY.4`.

Current state: the package has browser-safe `./log` and `./state` subpaths,
Node-tier `./producer` and `./workflow-engine` subpaths, and `./test-utils` for
test server helpers. Dependency-cruiser guards keep `@firegrid/client` away
from the broad root and Node-tier/test-only subpaths.

### Runtime Context And Control State

Runtime context control state lives under:

```txt
packages/runtime/src/control-plane/runtime-context/**
packages/protocol/src/launch/state.ts
```

`RuntimeControlPlaneLive` uses `createDurableStateDb` and
`runtimeContextStateSchema` for context/run rows. This aligns with
`firegrid-durable-launch-runtime-operator.LAUNCH_ROWS.1`,
`firegrid-durable-launch-runtime-operator.LAUNCH_ROWS.4`, and
`firegrid-durable-launch-runtime-operator.STREAM_TRUTH_BOUNDARY.1`.

Current naming issue: `control-plane` remains in runtime, even though target
architecture also discusses a possible bounded-context layout. This is not a
behavioral problem, but docs should stop treating old paths as final.

### Runtime Output Journal

Runtime stdout/stderr capture lives under:

```txt
packages/runtime/src/data-plane/runtime-output/writer.ts
packages/protocol/src/launch/schema.ts
```

The writer appends schema-validated raw runtime journal events through
`openDurableStreamProducer`. It does not emit State Protocol changes for output
facts. This aligns with:

- `firegrid-durable-launch-runtime-operator.JOURNAL_ROWS.1`
- `firegrid-durable-launch-runtime-operator.JOURNAL_ROWS.2`
- `firegrid-durable-launch-runtime-operator.JOURNAL_ROWS.3`
- `firegrid-durable-launch-runtime-operator.JOURNAL_ROWS.6`
- `firegrid-durable-launch-runtime-operator.STREAM_TRUTH_BOUNDARY.2`

Current gap: runtime input/agent ingress is not symmetric with runtime output.
Tracer 012 owns that.

### Sandbox Slot

Sandbox core:

```txt
packages/sandboxes-core/src/SandboxProvider.ts
```

Local-process provider:

```txt
packages/sandbox-local-process/src/LocalProcessSandboxProvider.ts
```

Runtime workflow depends on `SandboxProvider` from the core package; runtime
host wires the local-process provider. The provider-neutral core no longer
imports `@effect/platform`, and local-process owns `CommandExecutor`.

This aligns with:

- `firegrid-durable-launch-runtime-operator.SANDBOX_PROVIDERS.1`
- `firegrid-durable-launch-runtime-operator.SANDBOX_PROVIDERS.4`
- `firegrid-durable-launch-runtime-operator.SANDBOX_PROVIDERS.5`
- `firegrid-durable-launch-runtime-operator.SANDBOX_PROVIDERS.6`
- `firegrid-durable-launch-runtime-operator.LAUNCH_OPERATOR.3`
- `firegrid-durable-launch-runtime-operator.LAUNCH_OPERATOR.5`

### Materialization Strategies And Targets

Materialization currently lives under:

```txt
packages/runtime/src/data-plane/materialization/**
```

Core vocabulary:

- `EventSource`
- `EventProjector`
- `EventSink`
- `EventPipeline`
- `ProjectionDefinition`
- `ProjectionTarget`
- `MaterializationStrategy`
- `ProjectionQuery`

Strategies/providers:

- State Protocol strategy: `state-protocol/StateProtocolStrategy.ts`;
- raw-fold strategy: `raw-fold/RawFoldStrategy.ts`;
- Materialize provider/sink: `materialize/*` and `sinks/materialize/*`;
- session projection target descriptor:
  `session-projection-definition.ts`.

Tracer 011 removed the worst hardcoded session coupling from
`StateProtocolStrategy`: target descriptors now provide state schema, encoder,
fold, and query adapter.

Current gap: Materialize remains provider-backed and not fully behind the same
strategy contract, per `firegrid-materialization-engines.MATERIALIZE.5`.

### Required-Action Workflow

Required actions live under:

```txt
packages/runtime/src/required-action/**
```

The current surface includes:

- `RequiredActions` service;
- `RequiredActionsLive`;
- `RequiredActionRuntimeLive`;
- `RequiredActionWorkflow`;
- `startRequiredAction`.

It records durable request and resolution rows and uses
`@effect/workflow` `DurableDeferred` for durable wait/resume.

This aligns with:

- `firegrid-required-actions.RECORDS.1`
- `firegrid-required-actions.RECORDS.2`
- `firegrid-required-actions.RECORDS.3`
- `firegrid-required-actions.WORKFLOW.1`
- `firegrid-required-actions.WORKFLOW.2`
- `firegrid-required-actions.WORKFLOW.3`
- `firegrid-required-actions.WORKFLOW.4`
- `firegrid-required-actions.WORKFLOW.5`
- `firegrid-required-actions.BOUNDARY.1`
- `firegrid-required-actions.BOUNDARY.2`
- `firegrid-required-actions.BOUNDARY.3`
- `firegrid-required-actions.BOUNDARY.4`

Current gap: required-action schemas and durable store semantics are
runtime-local. The tracer report explicitly defers protocol schema extraction
and Durable Streams State descriptor design.

### Client And Protocol Roles

`@firegrid/protocol` is aligned as shared schema base. It currently owns:

- launch/runtime context schemas;
- runtime journal schemas;
- runtime-output cursor helpers;
- session projection schemas;
- session State Protocol descriptors.

`@firegrid/client` owns:

- public launch input decode/normalization;
- app-facing `Firegrid.launch(...)`;
- app-facing `Firegrid.open(contextId).snapshot`;
- retained snapshot reads across control plane and runtime-output journal.

`@firegrid/client` does not import runtime code or the broad Durable Streams
root. It imports `@firegrid/durable-streams/log` for retained runtime-output
reads and `@firegrid/durable-streams/state` for browser-safe StreamDB state.

### Planned But Not Implemented

Agent ingress is planned by tracer 012 and `firegrid-agent-ingress.*`, but no
`packages/runtime/src/agent-ingress/**` exists yet.

Workflow-backed tools are planned by tracer 010 but are not implemented.

Runtime adapter packages such as ACP/Claude Code are not implemented. This is
correct: target docs say not to create speculative packages ahead of tracer
pressure.

## Deviation Inventory

| Area | Current implementation/files | Target/proposed design | Category | Severity | Blocks | Impact | Recommended next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Client Durable Streams reachability | `packages/client/src/firegrid.ts` imports from `@firegrid/durable-streams/log` and `@firegrid/durable-streams/state`; dependency-cruiser blocks the broad root and Node-tier/test-only subpaths. | Client should remain browser/edge safe and consume only narrow browser-safe retained-log/state helpers. Ref: `firegrid-platform-invariants.LOCALITY.2`, `firegrid-platform-invariants.LOCALITY.7`, `firegrid-architecture-boundary.DEPENDENCY_GRAPH.8`. | Aligned | Resolved by Lane A | Future client/open/observe surface hardening. | Production client code no longer statically reaches workflow-engine, producer, server, or test utility modules. | Keep the dependency-cruiser rules in place as merge criteria for future client work. |
| Direct Durable Streams imports outside substrate | `rg '@durable-streams' packages apps scenarios` returns direct imports only inside `packages/durable-streams/**`; Flamecast uses Firegrid subpaths. | Direct imports of underlying Durable Streams packages stay contained by `@firegrid/durable-streams`. Ref: `firegrid-architecture-boundary.DEPENDENCY_GRAPH.7`. | Aligned | Resolved by Lane A | Substrate package hardening and provider adapter tracers. | The old app exemption is no longer needed. | Keep the containment dependency-cruiser rule and avoid reintroducing app-specific exemptions. |
| Required-action durable state shape | `packages/runtime/src/required-action/schema.ts` and `service.ts` append/read raw retained required-action rows. | Required-action workflow authority is runtime-owned, but protocol/state ownership should be settled before cross-runtime clients and tools depend on it. Ref: `firegrid-required-actions.RECORDS.1`, `firegrid-required-actions.RECORDS.2`, `firegrid-required-actions.RECORDS.3`, `firegrid-required-actions.WORKFLOW.3`. | Needs Decision | Blocker | Tracer 012 agent ingress and tracer 010 workflow-backed tools. | Current behavior works, but ingress/tools will depend on required-action records; leaving ownership runtime-local by accident makes the future API harder to move. | Decide whether required-action row schemas/descriptors move into `@firegrid/protocol`, remain runtime-local by explicit architecture decision, or get a State Protocol projection target. |
| Required actions not integrated into runtime host root | `RequiredActionRuntimeLive` is separate from `FiregridRuntimeHostLive`. | Runtime host should own host-wide workflow/state topology for runtime work, or required actions should be documented as a sibling runtime program. | Needs Decision | Blocker for ingress/tools | Tracer 012 agent ingress and tracer 010 workflow-backed tools. | Future agent ingress and workflow-backed tools may need both runtime context and required actions; separate roots can lead to duplicate stream topology config. | Decide whether `FiregridRuntimeHostLive` gains `requiredActions` stream config or whether required actions intentionally remain a sibling runtime program. |
| Materialization remains under runtime `data-plane` subpaths | `packages/runtime/src/data-plane/materialization/**`; exported subpaths include `@firegrid/runtime/data-plane/materialization/*`. | Target architecture proposes `@firegrid/materialization` with core/state-protocol/raw-fold/materialize subpaths, while current runtime-host direction treats materialization as a pluggable strategy. | Needs Decision | Blocker | Materialize strategy tracer, runtime-host config work, future projection target packages. | Public API names are stale and tie materialization to runtime package internals while more strategy surfaces are about to accrete. | Decide before more materialization work: document staged runtime subpaths, rename runtime subpaths, or extract `@firegrid/materialization`. |
| Materialize not fully behind common strategy | `packages/runtime/src/data-plane/materialization/materialize/*`, `materialize-pipeline.ts`, `sinks/materialize/*`. | `firegrid-materialization-engines.MATERIALIZE.5` says Materialize remains provider-backed until wired behind common strategy. | Expected Gap | Blocks Materialize strategy work | Materialize strategy tracer and any host-level materialization configuration. | Materialize path can still evolve separately from state-protocol/raw-fold strategy API. | Follow-up Materialize strategy adapter after target/query contract stabilizes. |
| Tracer 008 scenario proof is indirect | No `scenarios/firegrid/src/tracer-008.test.ts`; tracer 002 and 011 scenarios cover materialization parts. | `firegrid-platform-invariants.PRODUCTION_SURFACE.5` requires scenario-level E2E for implemented tracers. | Actual Deviation | Blocker | Future materialization strategy work and scenario coverage policy. | Reviewers cannot directly map tracer 008 acceptance to a scenario file. | Add a tracer-008 scenario that runs the same session projection through at least two strategies, or document tracer 002/011 as the accepted spec-approved coverage map. |
| Agent ingress absent | No `packages/runtime/src/agent-ingress/**`. | Tracer 012 target: durable input request and delivery progress owned by runtime host. Refs: `firegrid-agent-ingress.PROMPTS.1`, `firegrid-agent-ingress.PROMPTS.2`, `firegrid-agent-ingress.PROMPTS.3`, `firegrid-agent-ingress.PROMPTS.4`, `firegrid-agent-ingress.DELIVERY.1`, `firegrid-agent-ingress.DELIVERY.2`, `firegrid-agent-ingress.DELIVERY.3`, `firegrid-agent-ingress.DELIVERY.4`, `firegrid-agent-ingress.HOST.1`, `firegrid-agent-ingress.HOST.2`, `firegrid-agent-ingress.HOST.3`. | Expected Gap | Blocks provider adapters | Real ACP/Claude/provider adapter tracers. | Real provider work has no durable input authority and will otherwise overload launch argv/stdin. | Run tracer 012 before real runtime adapter/provider tracers, after the above substrate/required-action decisions are settled. |
| Runtime/context protocol namespace still under `launch` | `packages/protocol/src/launch/schema.ts` contains runtime context, runtime run, and runtime output schemas. | Target package doc proposes `runtime-context` and `runtime-output` protocol namespaces. | Documentation Drift | Non-blocking | None if documented. | The `launch` namespace is serviceable but increasingly broad. | Update target docs to accept current `launch` staging or run a mechanical protocol namespace split when churn is low. |
| ADR still references old sandbox runtime path | `docs/proposals/ADR_RUNTIME_CONTROL_PLANE_AND_DATA_PLANE_BOUNDARY.md` mentions `packages/runtime/src/data-plane/execution/sandbox/*`. | Tracer 007 moved sandbox to packages. | Documentation Drift | Non-blocking | None if documented. | Readers may think sandbox remains runtime-internal. | Update ADR with a "superseded by tracer 007" note rather than rewriting history. |
| Runtime package has no package-level production root, but docs path is missing | Prompt referenced `docs/proposals/SDD_FIREGRID_RUNTIME_PACKAGE_HAS_NO_PRODUCTION_ROOT.md`; current main does not contain that file. | Target asks to avoid a broad umbrella root while keeping production composition surfaces. | Documentation Drift | Non-blocking | SDD review follow-up. | Reviewers lack the SDD source in current main; architecture arguments are split across target doc and tracer docs. | Restore/rename the SDD or add a short current-status note to `managed-agent-runtime-target.md`. |
| Package manifests export TypeScript source | All packages export `./src/*.ts`; `files` points at `dist`, but root exports point at source. | `firegrid-platform-invariants.PACKAGE_DISCIPLINE.7` expects dist-only public package manifests for packed consumers. | Risk Accepted | Non-blocking until packaging lane | Package publication/packaging tracer. | Workspace development is fine, but publish/pack consumption will need a packaging pass. | Keep as accepted monorepo-stage risk until package publication tracer; do not mix with architecture tracer work. |
| Dependency-cruiser Durable Streams guardrails | `.dependency-cruiser.cjs` now guards direct `@durable-streams/*` imports outside `packages/durable-streams` and blocks client reachability to broad/root Node-tier substrate paths. | Tracer 005 boundary should be mechanically protected. Ref: `firegrid-architecture-boundary.DEPENDENCY_GRAPH.7`, `firegrid-architecture-boundary.DEPENDENCY_GRAPH.8`. | Aligned | Resolved by Lane A | All future substrate-facing tracers. | `pnpm run lint:deps` now protects this boundary. | Keep app exemptions out unless target architecture explicitly accepts one and the rule encodes it. |

### Expected Gap Versus Tracer Blocker

An `Expected Gap` label means the codebase is not wrong for the tracers already
merged. It does not mean the gap is safe to build past. For this review, the
following expected gaps still block named future lanes:

- Agent ingress absence is expected before tracer 012, but it blocks provider
  adapter work because durable input authority does not exist yet.
- Materialize strategy incompleteness is expected before the Materialize
  strategy tracer, but it blocks host-level materialization configuration.
- Required-action runtime-local state was acceptable for tracer 009, but it
  blocks tracer 012 and tracer 010 unless accepted as the durable ownership
  model.
- Materialization living under `data-plane` was acceptable for tracer 008/011,
  but it blocks adding more production surfaces under that path without a
  namespace/package decision.

## Exported API Review

### `@firegrid/protocol`

Exports:

- `.`
- `./launch`
- `./session`

Matches intended boundary:

- Yes for current launch/session state. Protocol is browser-safe and has no
  package edge to client or runtime.

Boundary risks:

- Runtime context, runtime run, and runtime journal schemas all live under
  `launch`. This is acceptable staging but no longer matches the target doc's
  suggested `runtime-context` / `runtime-output` split.
- Required-action schemas are not in protocol yet.

### `@firegrid/durable-streams`

Exports:

- `.`
- `./log`
- `./state`
- `./producer`
- `./workflow-engine`
- `./test-utils`

Matches intended boundary:

- Yes for owning direct `@durable-streams/*` imports in packages, apps, and
  scenarios.
- `./log` and `./state` are the browser-safe substrate entrypoints currently
  used by `@firegrid/client`.
- `./producer` and `./workflow-engine` are Node-tier/runtime substrate
  entrypoints.
- `./test-utils` is appropriately separate from root.

Boundary risks:

- The root export remains broad for compatibility. This is acceptable only
  because browser-safe consumers are expected to use subpaths and
  dependency-cruiser blocks `@firegrid/client` from importing the root.

### `@firegrid/client`

Exports:

- `.`

Matches intended boundary:

- Yes for current launch/open scope. It exposes public Firegrid launch/open
  surfaces and depends on protocol plus browser-safe Durable Streams subpaths.
  It has no runtime edge.

Boundary risks:

- It currently has no required-action resolve/observe operator API. That is a
  future decision, not a current bug.

### `@firegrid/runtime`

Exports:

- `.`
- `./required-action`
- `./data-plane/materialization`
- `./data-plane/materialization/core`
- `./data-plane/materialization/raw-fold`
- `./data-plane/materialization/state-protocol`
- `./data-plane/materialization/materialize`

Matches intended boundary:

- The root exposes `FiregridRuntimeHostLive`, `startRuntime`, and
  required-action surfaces through package exports, satisfying
  `firegrid-durable-launch-runtime-operator.LAUNCH_OPERATOR.9`.
- Runtime does not import client.

Boundary risks:

- Materialization subpath names expose stale physical `data-plane` layout.
- Required-action schemas and durable storage remain runtime-local.
- Runtime host root does not include materialization or required-action wiring.

### `@firegrid/sandboxes-core`

Exports:

- `.`

Matches intended boundary:

- Yes. It owns provider-neutral sandbox contract and depends only on `effect`.
- It does not import `@effect/platform`.

Boundary risks:

- `SandboxConfig` still contains broad cross-provider fields. This is okay for
  tracer 007 but should be pressure-tested by a second provider.

### `@firegrid/sandbox-local-process`

Exports:

- `.`

Matches intended boundary:

- Yes. It owns local process and Effect Platform `CommandExecutor` integration.
- `LocalProcessSandboxProvider.layer()` captures platform dependencies and
  provides the provider-neutral core service.

Boundary risks:

- Helper `localProcess(...)` is a sketch not integrated into public client
  launch input. This is a tracer 012 or launch-slot follow-up, not a current
  bug.

### `apps/flamecast`

Exports:

- None as package API.

Boundary risks:

- Flamecast still models older product/runtime concerns, but not through direct
  `@durable-streams/*` imports.
- Durable Streams import containment guardrails include apps, so future direct
  substrate imports must be intentionally exempted rather than accidental.

## Scenario / Production Surface Review

Scenario files present:

- `scenarios/firegrid/src/tracer-001.test.ts`
- `scenarios/firegrid/src/tracer-002.test.ts`
- `scenarios/firegrid/src/tracer-007.test.ts`
- `scenarios/firegrid/src/tracer-009.test.ts`
- `scenarios/firegrid/src/tracer-011.test.ts`

Confirmed production-surface proofs:

- Tracer 001 starts with public `Firegrid.launch(...)`, runs through
  `FiregridRuntimeHostLive` / `startRuntime`, and observes retained
  runtime-output rows. This satisfies
  `firegrid-durable-launch-runtime-operator.LAUNCH_OPERATOR.10` and
  `firegrid-durable-launch-runtime-operator.RUNTIME_HOST.4`.
- Tracer 002 materializes retained runtime-output events to session state
  through exported runtime materialization surfaces.
- Tracer 007 has a tracer-specific scenario proving `FiregridRuntimeHostLive`
  uses the extracted sandbox provider path and observes stdout/stderr plus
  exited run evidence.
- Tracer 009 invokes exported `@firegrid/runtime` required-action surfaces and
  observes durable request/resolution/wait behavior.
- Tracer 011 appends runtime-output facts, runs the production State Protocol
  strategy, and queries through target-owned State Protocol behavior.

Missing or indirect proofs:

- Tracer 005 has no dedicated scenario file. It is indirectly protected by
  tracer 001/002 scenarios plus durable-streams package tests.
- Tracer 006 has no dedicated scenario file. It is effectively covered by
  tracer 001 and tracer 007 scenarios because both use `FiregridRuntimeHostLive`.
- Tracer 008 has no dedicated scenario file. Its strategy swapability is mostly
  covered by package tests and later tracer 011 scenario coverage. This is the
  most important scenario-proof gap.

Scenario wiring quality:

- Current scenarios configure production surfaces; they do not own the core
  runtime context Layer graph.
- `scenarios/firegrid/src/scenario-harness.ts` is a test helper for Durable
  Streams test server and client configuration; it does not wire sandbox or
  runtime internals.

## Composition Root Review

Production-like roots today:

- `FiregridRuntimeHostLive` in `packages/runtime/src/runtime-host/index.ts`;
- `RequiredActionRuntimeLive` in
  `packages/runtime/src/required-action/launcher.ts`;
- strategy constructors under
  `packages/runtime/src/data-plane/materialization/*`.

Scenario-only wiring that remains:

- Test server creation and stream URL allocation in scenario harnesses.
- Materialization strategy selection in tracer scenarios.
- Required-action stream topology in tracer 009 scenario.

Assessment:

- The runtime context execution path has a real production root.
- Required actions and materialization have production package surfaces but are
  not selected by a single host root yet.
- This is acceptable staging after tracers 006, 008, 009, and 011, but the next
  tracer wave should avoid adding a third or fourth independent root without a
  host-topology decision.

Before the next tracer wave:

1. Decide whether `FiregridRuntimeHostLive` should grow optional
   `requiredActions` and materialization topology.
2. Decide whether materialization extraction happens before or after agent
   ingress.
3. Add graph guardrails for browser-safe Durable Streams subpaths.

## Architecture Graph Reading

Workspace graph:

- [docs/dependency-graph.mmd](../dependency-graph.mmd)
- [docs/dependency-graph-detail.mmd](../dependency-graph-detail.mmd)

The workspace graph shows the intended high-level package direction:

```txt
protocol <- durable-streams <- runtime
protocol <- client
sandboxes-core <- sandbox-local-process <- runtime
```

It also shows Flamecast as a separate app island that now reaches Durable
Streams through Firegrid subpaths rather than raw Durable Streams imports.

Runtime graph:

- [docs/dependency-graph-runtime.mmd](../dependency-graph-runtime.mmd)
- [docs/dependency-graph-runtime-detail.mmd](../dependency-graph-runtime-detail.mmd)
- [docs/dependency-graph-runtime-control-data-detail.mmd](../dependency-graph-runtime-control-data-detail.mmd)

The runtime graph shows expected orchestration:

- `runtime-host/index.ts` depends on runtime context workflow/service,
  runtime-output writer, Durable Streams workflow engine, and sandbox local
  process provider.
- `control-plane/runtime-context/workflow.ts` depends on the sandbox core
  contract and runtime-output writer.
- materialization is internally cohesive but large; the detail graph is noisy
  because old `event-pipeline`, strategy, sink, provider, and projection target
  vocabulary coexist.

Client graph:

- [docs/dependency-graph-client.mmd](../dependency-graph-client.mmd)

The client graph is small and now shows only
`@firegrid/durable-streams/log` and `@firegrid/durable-streams/state`.
A useful follow-up graph cut would assert browser-safe reachability from
`packages/client/src/index.ts` stays within those subpaths.

Protocol graph:

- [docs/dependency-graph-protocol.mmd](../dependency-graph-protocol.mmd)

The protocol graph is healthy and small.

Flamecast graph:

- [docs/dependency-graph-flamecast.mmd](../dependency-graph-flamecast.mmd)
- [docs/dependency-graph-flamecast-detail.mmd](../dependency-graph-flamecast-detail.mmd)

The Flamecast graph no longer shows app code using raw Durable Streams APIs;
remaining Flamecast concerns are product/runtime migration issues, not
substrate import leaks.

Recommended better graph cuts:

- A browser-safe reachability graph starting from `packages/client/src/index.ts`.
- A public-entrypoint reachability graph for every `packages/*/package.json`
  export.
- A substrate-leak graph for any import of `@durable-streams/*` outside
  `packages/durable-streams`.
- A scenario-to-production-surface graph that excludes tests but includes
  scenario entrypoints.

## Recommended Architecture Stabilization Plan

The next work should not be another feature tracer. It should be a stabilization
wave that resolves the blocker decisions above, adds mechanical guardrails, and
updates target docs so the next tracer starts from accepted architecture rather
than review notes.

Stabilization wave:

1. Durable Streams browser-safe entrypoint cleanup is complete in
   Stabilization Lane A: narrow subpaths exist, `@firegrid/client` imports only
   `./log` and `./state`, Flamecast no longer imports `@durable-streams/*`
   directly, and dependency-cruiser guards the boundary.
2. Decide the materialization namespace/package/root strategy. Either keep
   `@firegrid/runtime/data-plane/materialization/*` as a documented staged API,
   rename runtime subpaths, or extract `@firegrid/materialization`. Do this
   before adding more Materialize strategy or runtime-host configuration work.
3. Decide required-action schema/state ownership. Move schemas/descriptors to
   protocol, declare runtime-local ownership as permanent for now, or define a
   State Protocol projection target. Do this before tracer 012 and tracer 010.
4. Backfill tracer-008 scenario coverage or add a spec-approved coverage map
   that explicitly names tracer 002/011 as satisfying the scenario proof.
5. Update target architecture docs to reflect accepted decisions, including
   Durable Streams entrypoints, materialization namespace, required-action
   ownership, sandbox extraction, and any accepted Flamecast exemption.

Recommended next 3-5 load-bearing tracers or PRs:

1. **Required-action protocol/state ownership cleanup**: move schemas to
   protocol or explicitly document runtime-local ownership as the accepted
   model; decide raw facts vs State Protocol projection.
2. **Tracer 012 agent ingress**: implement durable input request and delivery
   progress before real provider adapters.
3. **Materialize strategy adapter / materialization package decision**: finish
   `firegrid-materialization-engines.MATERIALIZE.5` and decide package
   extraction.
4. **Tracer 010 workflow-backed tools**: after ingress and required-action
   topology are stable, expose durable tools like `sleep`, `wait_for`, and
   `spawn`.
5. **Package publication/export hardening**: address dist-only package exports
   when workspace packages are ready for packed downstream consumption.

## Future Tracer Merge Criteria

These rules should be applied before merging additional feature tracers:

1. No tracer lands without a dedicated scenario E2E or an explicit
   spec-approved coverage map in the tracer doc. The coverage map must name the
   scenario files that prove the tracer and cite the relevant full ACIDs, such
   as `firegrid-platform-invariants.PRODUCTION_SURFACE.5`.
2. No new direct `@durable-streams/*` import lands outside
   `@firegrid/durable-streams` unless the target architecture explicitly
   accepts an exemption and dependency-cruiser encodes that exemption.
3. No browser/client package may import a root export that statically reaches
   workflow-engine, producer, server, Node platform, SQL, sandbox provider, or
   test utility modules.
4. No new production surface should be added under stale `control-plane` or
   `data-plane` paths without a migration note that says whether the path is
   permanent, staged, or scheduled for extraction.
5. No new runtime-host configurable concern should land without documenting
   whether it belongs to `FiregridRuntimeHostLive`, a sibling runtime program,
   or the public client launch/request plane.
6. No future tracer should add a second composition root for the same runtime
   concern without either merging it into the existing host root or documenting
   why it is intentionally independent.

Target architecture doc updates needed:

- Update `docs/architecture/managed-agent-runtime-target.md` to reflect that
  top-level packages such as `packages/sandboxes-core` and
  `packages/sandbox-local-process` are the current workspace-compatible shape
  when nested package globs are not enabled.
- Add a current-status note that materialization is staged under
  `@firegrid/runtime/data-plane/materialization/*` until package extraction
  earns itself.
- Keep the Durable Streams section explicit that browser/client consumers use
  browser-safe subpaths instead of the broad root.
- Add a note that required actions are currently runtime-local after tracer
  009, with schema/state ownership intentionally deferred.
- Restore or replace the missing
  `docs/proposals/SDD_FIREGRID_RUNTIME_PACKAGE_HAS_NO_PRODUCTION_ROOT.md`
  referenced by review prompts, or fold that thesis into the managed-agent
  runtime target doc.

Acceptable deviations to leave until named future tracers:

- No runtime adapter packages yet.
- No workspace/tool/secret packages yet.
- No agent ingress yet, as long as real provider work waits for tracer 012.
- Materialization package extraction, as long as public subpaths are documented
  as staged.
- Package manifests exporting TypeScript source during monorepo development,
  until package publication/packaging becomes an explicit lane.

## Appendix

### Commands Run

```sh
pnpm install
pnpm run arch:deps
pnpm run arch:deps:detail
pnpm run lint:deps
```

Validation commands run before PR:

```sh
pnpm run check:docs
pnpm run check:specs
pnpm run lint:deps
git diff --check
```

`pnpm install` completed with warnings about missing unbuilt runtime bin files
for scenario package links. No build was required for this documentation lane.

### Assumptions

- The prompt referenced
  `docs/proposals/SDD_FIREGRID_RUNTIME_PACKAGE_HAS_NO_PRODUCTION_ROOT.md`, but
  that file is not present on current `origin/main` at `d55442e`. This review
  uses `docs/architecture/managed-agent-runtime-target.md`,
  `docs/tracers/README.md`, and the current tracer result docs as the available
  source of truth for that thesis.
- This review treats generated dependency graph changes as review artifacts,
  not implementation changes.
- This review does not attempt to fix critical findings in code. Per scope, it
  documents deviations and recommends follow-up tracers or cleanup PRs.

### Acai Notes

This review used Acai conventions by citing complete ACIDs for spec-governed
boundaries. That made it easier to separate expected tracer gaps from actual
violations of current invariants.
