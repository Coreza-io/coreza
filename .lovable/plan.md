# Execute All: stop the run on the first node failure

## Goal and acceptance contract

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
| Actual button caller | `src/pages/WorkflowEditor.tsx:1431–1452` awaits the executor inside `try/finally` and releases the session lock. | No production editor refactor is needed for normal failure cleanup. Verify this through integration, not just executor tests. |
| Alternative wrapper | `src/hooks/useWorkflowExecution.ts:120–139` shows success whenever the executor resolves. Search found its definition but no imported use in `src`. | Leave this unused wrapper outside the minimal change; its success contract must be corrected before it becomes a live caller. |
| Timeouts/subscriptions | `workflowExecutor.ts:488–589, 721–730` propagates subscription and timeout errors. Normal execution uses a 30-second `Promise.race`; streaming polls recursively. | These errors must also stop subsequent scheduling, but throwing does not cancel a remote operation or dispose polling. |
| Loop feedback | `workflowExecutor.ts:595–630` writes `_edgeBuf` into `ExecutionContext`; `setNodeData` merges state. | Clearing the scheduler's `edgePayload` is not equivalent to resetting all Loop/input state. Do not promise a fresh runtime reset. |
| Compiler/test setup | `tsconfig.app.json` targets ES2020; `jest.config.json` uses Jest/ts-jest and `tests/setup.ts` imports backend Supabase configuration. | Do not require ES2022 `Error` cause options. Isolate regression tests from real database traffic. |

The screenshot/attachment does **not** establish why the Backtest ID expression resolves incorrectly. That diagnosis remains separate from the confirmed scheduler defect.

## Scope

**Production:** `src/utils/workflowExecutor.ts`, restricted to the Execute All failure path and its existing outer error reporting.

**Tests:** new `tests/workflowExecutor.test.ts`, plus a focused editor integration/browser check following the existing browser-test conventions.

Preserve individual Execute, editor-local Cluster Execute, successful conditional routing, pins, Loop aggregation, historical OnBar replay, and manual Stop behavior. No backend, migration, API, worker queue, cluster projection, graph mutation, execution-intent type, or action-registry redesign is required.

## Implementation steps

### 1. Establish failing regression tests

1. Use the current Jest conventions and instantiate a real `WorkflowExecutor` with a fresh `ExecutionContext` and unique editor session per test.
2. Register deterministic actions through `registerEditorNodeAction`, or mock only the action boundary when necessary. Keep the real queue, routing and error boundary under test.
3. Capture action invocation order, store outputs, functional node/edge updates, active-node callbacks and run-level notifications.
4. Model roots using the executor's actual trigger/backtest definition rules and Loop using its current node type and `done`/feedback state, not a different scheduler contract.
5. Use fake timers for highlighting delays and timeouts; advance only the timers needed for each scenario. Clear registrations and test timers afterward.
6. Mock the existing setup's Supabase client/configuration for isolated tests; never query production or place real credentials in test fixtures. Do not change global test setup unless isolation cannot otherwise be achieved.
7. First demonstrate continued execution in the root, sibling and OnBar cases. These are correctness tests, not assertions about copy or styling.

### 2. Replace queue continuation with failure propagation

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

### 3. Preserve the existing outer boundary and caller contract

1. Let either `await runInnerQueue()` reject into the enclosing catch. This prevents entering or continuing OnBar replay and bypasses completion reporting.
2. Keep the executor as the single owner of the run-level destructive failure notification for the actual editor button path. Make its existing message communicate that execution stopped and include the contextual error.
3. Normalize the outer caught value safely; avoid assuming every thrown value has a usable `.message`.
4. Do not rethrow from the outer catch or change `Promise<void>` to a new result type in this minimal patch. The actual editor has no catch; changing this contract would require coordinated caller changes.
5. Preserve the existing executor and editor `finally` blocks. Do not move token release to the node action or clear the entire output store.
6. Test that manual Stop remains the neutral stop path, not a newly invented failure signal. Preserve current treatment of returned cancelled outcomes unless a separate cancellation change is approved.

### 4. Preserve output and retry semantics honestly

- Keep already completed output values, pins and the failed node's inline error/previous output. Do not fabricate success for unexecuted nodes or clear all previews.
- Confirm a second run has a new local queue and no scheduler `edgePayload` from the failed run.
- For retry tests involving Loop feedback, distinguish scheduler-owned payloads from `_edgeBuf`, aggregate, input and loop-index state retained in `ExecutionContext`. Keep existing initialization behavior; no broad runtime reset is part of this fix.
- A pending/previous preview at a validation failure is not itself a new execution outcome. Improving its presentation or fixing the Backtest ID expression requires separate diagnosis.

## Regression matrix

Each test asserts exact invocation order/non-invocation and appropriate cleanup; error text alone is insufficient.

| Scenario | Required assertions |
| --- | --- |
| Root → failing action → child | Only root and failing action start; completed root output retained; child never invoked. |
| First of two queued roots fails | Second root never starts. |
| Fan-out with sibling already queued | Failing child prevents sibling and every later descendant from starting. |
| Validation failure | Action returns failed with “Backtest ID is required”; no downstream calls; failure identifies node ID and original error. |
| Direct throw and non-Error throw | Same fail-fast behavior; safe normalization; no secondary error while reporting. |
| OnBar returns `data.isLast: false`, downstream fails | No second OnBar call. |
| Failure during a later bar | Prior successful output retained; no later bar or queued sibling starts. |
| Loop body fails before returning feedback | No next Loop call, remaining body node or done-branch invocation. |
| Normal node timeout | At the existing 30-second threshold run ends; later nodes do not start. A late result does not restart this queue. |
| Subscription failure / first-data timeout | Both propagate to run-level failure and prevent subsequent work. Document timer/subscription limitations rather than concealing them with timer teardown. |
| Failure cleanup | Executor running flag false, active node null, transient highlights reset, one run-level destructive notification, no completion notification. |
| Correct input and retry | Same executor/session can start a successful new run; editor lock is reacquirable; failed-run queue/payload is not delivered. |
| Valid output shapes | `false`, a legitimate output property named `error`, pins and non-failure outcomes are not newly classified as failures. |
| Successful baselines | Ordinary chain, selected If/Switch branch, Loop feedback/done and multi-bar replay still work. |
| Manual Stop baseline | No later scheduler invocation after the in-flight step settles; existing neutral stopped reporting and cleanup remain. |

Keep existing editor-node and cluster execution suites passing; Cluster Execute remains an editor-local coordinator, not a Run All caller.

## Editor integration and browser acceptance

1. Exercise the actual Execute All control, not only the executor class. Use an authenticated local preview when available; follow the project's managed-session procedure without logging credentials.
2. Reproduce BacktestInit → OnBar → Consolidator → remaining nodes with the failing Backtest ID input. Inspect action calls/logs; an unchanged card alone does not prove non-execution.
3. Confirm failure naming OnBar's ID and original field error, no run-success notification, completed BacktestInit output retained, and Execute All returns to idle.
4. Confirm another execution can acquire the same editor session lock. Fix the input and retry without refreshing.
5. Repeat with two independent roots and a failure after one successful Loop/OnBar iteration.
6. If a deterministic browser fixture is required, it must exercise the real executor and shared-lock behavior. Do not claim a fixture alone verifies the actual WorkflowEditor caller; include the actual caller check or explicitly report it unverified.

## Verification and delivery order

1. Add and run red focused tests.
2. Apply the queue-catch and outer-reporting changes in one patch.
3. Run the focused Jest file and existing `editorNodeExecution` / `useClusterExecution` suites using repository test configuration.
4. Review diff for accidental changes to successful routing, cluster behavior, outputs and caller contracts.
5. Let the preview harness perform build/type verification; inspect its latest diagnostics and resolve related failures. Do not manually run project builds/typechecks.
6. Run focused browser/integration acceptance and `git diff --check`.
7. Update the implementation roadmap and, if needed, one architecture rule stating that editor Execute All fails fast while retaining completed outputs. Do not alter unrelated architecture rules.
8. Report observed test/browser results separately from unverified behavior. No application code or tests have been changed/run in this planning step.

## Limitations and release boundaries

- This is a sequential scheduler fix, not rollback of trading or other remote side effects already started before failure.
- `Promise.race` does not abort its underlying action. Streaming polling currently has no settled-state disposal, and its waiting flag clears on success only. Failure propagation alone must not be advertised as timer teardown, subscription cancellation or guaranteed protection from late output writes.
- Add narrow lifecycle cleanup only as separately identified work if timeout/browser tests demonstrate lingering activity; do not silently add a parallel cancellation framework to this patch.
- The unused `useWorkflowExecution` wrapper would still show success after a resolved handled failure. Before adopting it, coordinate an explicit result/caller contract and notification ownership. It is not the current button path.
- Missing preview access can block authenticated browser acceptance; isolated scheduler tests can still run, but must not stand in for verified editor lock/UI behavior.
- The Backtest ID expression cause remains unconfirmed and outside this scope.
