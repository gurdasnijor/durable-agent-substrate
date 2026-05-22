# S1 — input-suspend-crash-recovery · FINDING

**Verdict: GREEN — the axis-2 durability gap is CLOSED by the engine restart
recovery sweep (tf-12q9).** The S1 verdict that originally *confirmed* the gap
(clocks auto-recover on restart, table-waits don't) now *regression-guards the
fix*: the same probes that observed parked-and-unrecovered bodies now require
the body to auto-recover after reconstruction with no external re-drive.

## What it does

Real `DurableStreamsWorkflowEngine` over a run-scoped Durable Streams server. A
"generation" is one engine scope; closing it drops the in-memory
`running`/`workflows` maps and forked wakeup fibers (= process death) while the
durable rows persist on the server. A fresh engine layer over the SAME stream
URL is a faithful reconstruction — the same move
`DurableStreamsWorkflowEngine.test.ts` VALIDATION.3/.5 make across `runWith`.

The body is the tf-e5rf shape: point-read a workflow-owned input row; if absent,
`Workflow.suspend` (no `DurableDeferred` mailbox); if present, write a durable
processed-marker and complete. The marker is the engine-independent witness that
the body actually ran its consume step.

## The fix

`engine-runtime.ts` gains `recoverSuspendedExecutions(workflowName)`, the
symmetric counterpart to `recoverPendingClockWakeups`. It queries the
`executions` table for rows that are `suspended === true`, have no
`finalResult`, and are not `interrupted`, and re-`resume`s each one.

It is driven from **`register`** (not from engine construction) because `resume`
needs the workflow's execute fn (`workflows.get(name)`), and workflows register
*after* the engine layer is built (the engine is their dependency). At
construction the `workflows` map is empty, so a construction-time sweep would
no-op; registration is the first point the execute fn exists, and it runs on
every construction/reconstruction. (Clock recovery dodges this only because its
fire is delayed+forked, giving registration time to happen first.)

## Probes & results (post-fix)

| Probe | Sequence | After reconstruction (NO re-drive) |
|---|---|---|
| **A** — crash between write & resume | park → write input → DROP before `engine.resume` → reconstruct | sweep re-drives → `processed=true`, value=`delivered-by-A`, `finalResult` present |
| **B** — restart while parked, input present | park → write input → crash → reconstruct | sweep re-arms → `processed=true`, value=`delivered-by-B` |
| **C** — clock contrast / no-regression control | park on `DurableClock` (400ms) → crash before fire → reconstruct | `recoverPendingClockWakeups` still auto-fires → `auto-completed=true` |

Probes A and B no longer call `execute`/`resume` in the reconstruction
generation — doing so would mask whether the sweep did the work. They instead
**passively** bounded-wait (`awaitFinalResult`, 3s) for the auto-recovery to
complete, mirroring Probe C's contract. A regression that removes the sweep
leaves the body parked → the bounded wait times out → the driver fails loudly.

## Scope held

The sweep is the **restart pending-suspension recovery** variant (ii) from the
close-out. It does NOT build the **kernel-owned atomic write+arm** (variant
iii / i): the Probe A race window (input written, resume lost) is closed by
*recovery on the next reconstruction*, not by making write+resume atomic at the
source. That is acceptable here because the recovery sweep re-drives the body
"at least once" per reconstruction, and the body's input read + processed-marker
`insertOrGet` are idempotent. No deferred mailbox / input-intent bridge added.

## Run

```
pnpm --filter @firegrid/tiny-firegrid simulate run input-suspend-crash-recovery
```
