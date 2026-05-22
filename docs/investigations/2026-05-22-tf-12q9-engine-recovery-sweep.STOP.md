# tf-12q9 — engine restart recovery sweep · STOP

**Verdict: the default engine-level recovery sweep makes S1 Probes A/B/C green
but is NOT shippable — it regresses two engine invariants that origin/main holds.
The boundary the bead anticipated is reached: a kernel-owned write+arm
(serialized lifecycle ownership) is required.**

This is a STOP report per the bead's escape clause. The implementing diff (engine
sweep + adapted S1 sim) is left on the branch so both results are reproducible:
the green S1 run AND the two regressions.

## What was built (and proven green)

`recoverSuspendedExecutions(workflowName)` in
`packages/runtime/src/workflow-engine/internal/engine-runtime.ts`, the symmetric
counterpart to `recoverPendingClockWakeups`: on **workflow registration** (the
first point the execute fn exists; construction is too early because workflows
register *after* the engine layer builds), it queries the `executions` table for
rows that are `suspended === true`, have no `finalResult`, and are not
`interrupted`, and re-`resume`s each one.

The S1 `input-suspend-crash-recovery` sim was adapted: Probes A and B now drop
the explicit re-drive and **passively** bounded-wait (`awaitFinalResult`) for the
sweep to recover the parked table-wait body; Probe C (clock) is the
no-regression control.

```
pnpm --filter @firegrid/tiny-firegrid simulate run input-suspend-crash-recovery
=> S1 input-suspend-crash-recovery: GREEN
   Probe A after restart (NO redrive): processed=true value=delivered-by-A
   Probe B after restart (NO redrive): processed=true value=delivered-by-B
   Probe C after restart (NO resume): auto-completed=true
```

So the acceptance "A and B auto-recover after reconstruction without explicit
test redrive; C remains green" is met **in isolation**.

## Why it cannot ship — two regressions, evidenced

Running the full `@firegrid/runtime` suite with the sweep in place:

```
Test Files  2 failed | 20 passed (22)
     Tests  2 failed | 128 passed (130)
```

Both fail on this branch and **pass on a fresh origin/main worktree** (verified):

1. `DurableStreamsWorkflowEngine.test.ts > tf-gyxc keeps user-interrupted
   workflows terminal across engine reconstruction`
   → `expected false to be true` on `row.value.interrupted`.

2. `deferred-done-idempotency.test.ts > keeps a first failure exit even when a
   later success completion arrives`
   → `ParseError: Exit<string,string> … Fail.error Expected string, actual
   undefined` (a corrupted/concurrent exit encode).

Both failing workflows suspend on a **`DurableDeferred`**
(`DurableDeferred.await(Approval)` / `Gate`), then the *same* reconstructed
generation drives that execution explicitly (`interrupt`, `deferredDone`,
`execute`). The sweep, firing at registration, forks a second body fiber for the
same execution that **races** the generation's explicit lifecycle op:

- tf-gyxc: the swept body re-suspends and writes back `interrupted:false` from
  its stale instance, clobbering the concurrent `interrupt`'s `interrupted:true`.
- idempotency: the swept body and the `deferredDone`-driven body both complete
  the workflow and encode an exit concurrently, corrupting the persisted exit.

## Root cause — no durable discriminator between the two suspension kinds

The sweep is a blanket "resume every suspended execution." It cannot be narrowed
to *only table-waits* because **a deferred-wait and a table-wait are the same
thing at the engine-row level**:

- Vendored `repos/effect/packages/workflow/src/DurableDeferred.ts:116-119`:
  `await_` reads `engine.deferredResult(self)`; if `undefined`,
  `return yield* Workflow.suspend(instance)`. A `DurableDeferred.await` on an
  unresolved deferred **is** `Workflow.suspend` — the exact primitive a table
  wait uses.
- The `WorkflowExecutionRow` (`internal/table.ts:18-31`) records only
  `suspended`, `interrupted`, optional `cause`. Both suspension kinds produce an
  interrupt-only cause (`Workflow.suspend` self-interrupts the fiber); neither
  records *what* it is waiting on.
- A deferred ROW is not written until `deferredDone`, so at sweep time an
  execution parked inside `DurableDeferred.await` is byte-for-byte
  indistinguishable from a table-wait. (Skipping "has a deferred row" does not
  help: tf-gyxc and the idempotency case both sweep *before* any deferred row
  exists.)

Therefore an engine-level sweep that resumes "all suspended executions"
necessarily also resumes deferred-awaits, and re-driving a deferred-await injects
a concurrent body fiber the engine's existing recovery (`deferredDone → resume`)
and lifecycle (`interrupt`) paths do not expect. The hazard is not specific to
deferred-waits either: any reconstructed generation that *also* drives a swept
execution races the sweep — S1's probes are green only because their
reconstruction generation does nothing but observe.

## Why kernel-owned write+arm is required

Recovery must be owned by a **single serialized controller** (the
HostKernelWorkflow control plane), not a blanket resume scattered into every
engine generation, because the controller is the one component that can:

1. **Know what each suspension waits on.** It owns the durable request/input rows
   and can re-arm only genuine table-waits whose input is present, instead of
   guessing from an undifferentiated `suspended` flag.
2. **Serialize re-drive with lifecycle ops.** As the exclusive driver of
   `execute`/`resume`/`interrupt`/`deferredDone`, it never races itself — the
   exact property the engine-level sweep cannot have, since it has no knowledge
   of the operations the reconstructed generation will perform.

This matches the established direction: control-plane = HostKernelWorkflow, with
the engine as a mechanism it drives. The "write input row" + "arm the wait" pair
becomes one kernel-owned step, closing the Probe A race at the source rather than
relying on a racy after-the-fact resume.

## Scope held / what's on the branch

- Engine sweep + register hook (the demonstrated-green-but-regressing diff).
- Adapted S1 sim (A/B passive auto-recovery, C control) + updated FINDING.md.
- No deferred mailbox / input-intent bridge added.
- #663 branch untouched (S1 sim copied read-only from it).

Recommend: re-scope tf-12q9 to the kernel-owned write+arm slice (or split a
follow-on bead), and do **not** merge the engine sweep as-is.
