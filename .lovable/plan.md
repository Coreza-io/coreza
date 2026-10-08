# Execute All: stop the run on the first node failure

## Goal

Execute All must stop scheduling work as soon as a node fails. No queued root, sibling, descendant, Loop feedback iteration, or later OnBar iteration may start after that observed failure.

For the reported case:

```text
BacktestInit succeeds
  → OnBar fails: “Backtest ID is required”
  → Execute All ends
  → Consolidator, is4hrs, RollingWindow21, ATR14 and remaining work do not start
```

Show the failed node ID and original error, retain completed outputs and the node's existing inline error, return the Execute All button to idle, and release the editor execution lock so the user can correct the input and retry without refreshing.

This replaces the previous cluster-save/paste/Loop plan with the newly attached Execute All proposal. It does not implement either plan.

## Verified current state

The complete attachment was reviewed against checkout `4bfce2ad`, rather than assuming its reviewed snapshot is unchanged.

| Area | Confirmed evidence | Implication |
| --- | --- | --- |
| Required-field validation | `src/hooks/useNodeExecution.ts:444–451` returns `status: "failed"` and the field error. | Use the existing structured failure signal; no generic output inspection is needed. |
| Normal node invocation | `src/utils/workflowExecutor.ts:63–72` converts failed/cancelled outcomes to thrown errors. | Failures already reach the scheduler. Cancellation is currently represented as an error here; do not silently redesign it in this patch. |
| Queue catch | `workflowExecutor.ts:993–1018` records failure, then enqueues `independentNodes` without rethrowing. Previously queued nodes remain. | Confirmed primary defect: record-and-continue behavior. |
| OnBar replay | `workflowExecutor.ts:1024–1053` invokes the same queue first for the graph, then for later bars. | An inner-loop break alone is insufficient; failure must escape the queue to the enclosing boundary. |
| Run-level reporting | `workflowExecutor.ts:1081–1100` has neutral Stop, normal completion, and an outer destructive error notification. | Reuse the error boundary and bypass normal completion. |
| Executor cleanup | `workflowExecutor.ts:1101–1125` resets its token, running flag, active-node indicator and highlights. | Preserve cleanup on the failure path. Outputs are not globally cleared here. |
| Actual button caller | `src/pages/WorkflowEditor.tsx:1431–1452` awaits the executor inside `try/finally` and releases the session lock. | No production editor refactor is needed for normal failure cleanup. |
| Alternative wrapper | `src/hooks/useWorkflowExecution.ts:120–139` shows success whenever the executor resolves. Search found its definition but no imported use in `src`. | Leave this unused wrapper outside the minimal change; its success contract must be corrected before it becomes a live caller. |
| Timeouts/subscriptions | `workflowExecutor.ts:488–589, 721–730` propagates subscription and timeout errors. Normal execution uses a 30-second `Promise.race`; streaming polls recursively. | These errors must also stop subsequent scheduling, but throwing does not cancel a remote operation or dispose polling. |
| Loop feedback | `workflowExecutor.ts:595–630` writes `_edgeBuf` into `ExecutionContext`; `setNodeData` merges state. | Clearing the scheduler's `edgePayload` is not equivalent to resetting all Loop/input state. Do not promise a fresh runtime reset. |
| Compiler target | `tsconfig.app.json` targets ES2020. | Do not require ES2022 `Error` cause options. |

The screenshot/attachment does **not** establish why the Backtest ID expression resolves incorrectly. That diagnosis remains separate from the confirmed scheduler defect.

## Scope

**Production:** `src/utils/workflowExecutor.ts`, restricted to the Execute All failure path and its existing outer error reporting.

Preserve individual Execute, editor-local Cluster Execute, successful conditional routing, pins, Loop aggregation, historical OnBar replay, and manual Stop behavior. No backend, migration, API, worker queue, cluster projection, graph mutation, execution-intent type, or action-registry redesign is required.

## Implementation steps

### 1. Replace queue continuation with failure propagation

Inside the per-node catch in `executeAllNodes`:

1. Keep timing, failed-node bookkeeping and original error logging.
2. Keep `clearIncomingEdgePayloads(id)`.
3. Remove the complete `independentNodes` filter/enqueue block.
4. Empty the local queue and clear the executor's transient `edgePayload` map.
5. Normalize the caught value safely with `error instanceof Error ? error.message : String(error)`.
6. Throw a contextual error containing the reliable canonical node ID and original message. An existing display label may supplement the ID, never replace it.
7. Preserve the original exception in logging. Do not add unsupported `new Error(message, { cause })` options under the current ES2020 library target or change compiler settings just for this patch.

```ts
this.clearIncomingEdgePayloads(id);
queue.length = 0;
this.edgePayload.clear();
const message = error instanceof Error ? error.message : String(error);
throw new Error(`Execution stopped at node ${id}: ${message}`);
```

Do not call `stop()` as the failure mechanism; that selects the existing user-stop semantics. Do not only remove independent-node enqueueing or break the inner loop, since existing siblings and later OnBar work would remain possible.

### 2. Preserve the existing outer boundary and caller contract

1. Let either `await runInnerQueue()` reject into the enclosing catch. This prevents entering or continuing OnBar replay and bypasses completion reporting.
2. Keep the executor as the single owner of the run-level destructive failure notification for the actual editor button path. Make its existing message communicate that execution stopped and include the contextual error.
3. Normalize the outer caught value safely; avoid assuming every thrown value has a usable `.message`.
4. Do not rethrow from the outer catch or change `Promise<void>` to a new result type in this minimal patch. The actual editor has no catch; changing this contract would require coordinated caller changes.
5. Preserve the existing executor and editor `finally` blocks. Do not move token release to the node action or clear the entire output store.
6. Keep manual Stop as the neutral stop path, not a newly invented failure signal. Preserve current treatment of returned cancelled outcomes unless a separate cancellation change is approved.

### 3. Preserve output and retry semantics honestly

- Keep already completed output values, pins and the failed node's inline error/previous output. Do not fabricate success for unexecuted nodes or clear all previews.
- Each new run must use a new local queue with no scheduler `edgePayload` from the failed run.
- For retries involving Loop feedback, distinguish scheduler-owned payloads from `_edgeBuf`, aggregate, input and loop-index state retained in `ExecutionContext`. Keep existing initialization behavior; no broad runtime reset is part of this fix.
- A pending/previous preview at a validation failure is not itself a new execution outcome. Improving its presentation or fixing the Backtest ID expression requires separate diagnosis.

## Implementation order

1. Apply the queue-catch and outer-reporting changes together in `src/utils/workflowExecutor.ts`.
2. Preserve the existing executor/editor cleanup and completed outputs.
3. Keep all successful routing, cluster behavior and caller contracts unchanged.
4. Record the fail-fast architecture rule if needed, without altering unrelated rules.

No application code has been changed in this planning step.

## Limitations and release boundaries

- This is a sequential scheduler fix, not rollback of trading or other remote side effects already started before failure.
- `Promise.race` does not abort its underlying action. Streaming polling currently has no settled-state disposal, and its waiting flag clears on success only. Failure propagation alone must not be advertised as timer teardown, subscription cancellation or guaranteed protection from late output writes.
- Add narrow lifecycle cleanup only as separately identified work if lingering activity is separately confirmed; do not silently add a parallel cancellation framework to this patch.
- The unused `useWorkflowExecution` wrapper would still show success after a resolved handled failure. Before adopting it, coordinate an explicit result/caller contract and notification ownership. It is not the current button path.
- The Backtest ID expression cause remains unconfirmed and outside this scope.
