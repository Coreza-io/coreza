# Show correct cluster-run results in member output panels

## Confirmed findings

- The reported cluster run succeeded and persisted `BacktestInit` and `OnBar` outputs in `workflow_runs.result.nodeResults`; it created no `node_executions` rows.
- `useClusterExecution` polls the existing run-status endpoint but reads only `status` and `error_message`, then releases the active run. It never hydrates the live execution store.
- Member output panels subscribe to that live store, so they remain `pending` even when the cluster control shows Completed.
- `ExecutionContext.setNodeData` already protects registered pins, but `useNodeOutput` uses a truthiness test and therefore misses valid raw outputs such as `0`, `false`, `""`, and `null`.
- Collapsed member nodes remain mounted as hidden runtime hosts. The missing output is therefore a result-hydration problem, not a compact/expanded rendering problem.
- Queued `BacktestInit` currently starts `session.runAll()` without awaiting it. The outer workflow can be marked successful before the batch backtest finishes, and its persisted `OnBar` value is not guaranteed to be the final processed-bar output.
- Failed/cancelled workflow persistence currently updates rows only while status is `running` or `queued`; cancellation can race with partial-result persistence.

## Output semantics

For one accepted cluster run, display:

- **Ordinary executed node:** its persisted output.
- **Backtest Init:** its initialization output, including backtest/execution IDs and fetched-bar summary.
- **Repeated backtest node:** one latest executed-bar snapshot, clearly represented as the latest snapshot; do not load thousands of per-bar outputs into the panel.
- **Failed node:** its actual error plus supported partial data.
- **Skipped node:** an explicit skipped state and reason.
- **Unexecuted cluster member:** an explicit “Not executed in this run” state.
- **Pinned member:** its existing pinned output, unchanged.

Full performance metrics, trades, and equity history remain on the dedicated backtest results experience. The node panel shows the node’s latest execution snapshot.

## Implementation

### 1. Create one persisted-node-result contract

- Extract the result interpretation currently embedded in `useExecutionHistory` into a shared `normalizePersistedNodeResult` utility.
- Distinguish an absent result key from an explicit `null` result.
- Preserve an already normalized `StandardNodeOutput` without adding another `data` wrapper.
- Normalize legacy `{ success, data, error, status, meta }` envelopes, raw objects, arrays, primitive values, and structured errors.
- Preserve metadata and the `skipped` state; extend the shared frontend output-status type and output badge only as needed to represent persisted skipped results consistently.
- Handle malformed entries independently so one invalid node result cannot discard valid sibling outputs.
- Make execution history use the same utility. When `executionOrder` is absent or incomplete, append valid `nodeResults` keys in stable object-key order rather than hiding them.

### 2. Capture the exact submitted cluster scope

- When `prepareClusterExecution` saves the workflow, return the saved revision together with a snapshot of the requested cluster’s canonical `memberNodeIds`.
- Store an immutable active-run descriptor after the server accepts execution:

```text
workflowId
workflowSessionId
runId
clusterId
sourceRevision
memberNodeIds
executionGeneration
```

- Capture membership from the submitted saved revision, not from cluster state at result-arrival time.
- Update only captured member IDs that still exist in the current editor.
- Increment a shared execution generation whenever a cluster or individual-node run is accepted. An older cluster response must not overwrite a newer individual-node or cluster result.
- Continue using canonical member IDs only; never hydrate the synthetic compact-cluster display node.

### 3. Reset panels only after execution is accepted

- Add a scoped runtime-output reset for the captured members after the execute request returns a valid `run_id`.
- Preserve registered pins and clear no unrelated node, loop, stream, or global execution state.
- Replace each unpinned member output with an explicit pending state owned by the accepted run, preventing `useNodeOutput` from falling back to stale `data.output`.
- Do not clear previous results during save/preparation. A failed save or rejected execute request must leave useful existing outputs intact.
- If the accepted run later returns no result for a member, replace its pending state with “Not executed in this run”; do not revive the prior output.

### 4. Hydrate terminal results through the existing status endpoint

- Define a typed status response containing the required run identity, scope, source revision, status, error, and terminal `result`.
- On terminal success, failure, or cancellation:
  1. validate the response against the active-run descriptor;
  2. normalize every available captured-member result;
  3. assign explicit not-executed output to captured members with no result;
  4. batch `executionStore.setNodeData(nodeId, { output })` calls;
  5. call `useExecutionStoreNotify()` once;
  6. update the cluster control state and any non-fatal output warning;
  7. release the active-run descriptor.
- Keep execution outcome and output availability separate. A successful backend run remains Completed if its result is missing or malformed; show a retryable output warning rather than changing it to Failed.
- Use `workflow_runs.result.nodeResults` as the source. Do not call `/runs/:runId/executions` for this path unless the backend begins writing those rows.

### 5. Fix output presence and stale fallback

- Replace truthiness checks in `useNodeOutput` with explicit property-presence checks so `0`, `false`, `""`, and `null` render correctly.
- Make the accepted-run pending/not-executed markers authoritative over stale `data.output`.
- Preserve pinned-output precedence in both store writes and panel display.
- Ensure output changes received while collapsed appear on expansion, and remain unchanged across collapse/re-expand cycles.

### 6. Make polling race-safe

- Allow only one status request in flight per active run, using sequential polling or an in-flight guard.
- Recheck run ID, session ID, cluster ID, revision, and execution generation after every awaited request and before every store/state mutation.
- Abort pending requests during effect cleanup where supported.
- Hydrate each terminal run once, and mark hydration complete only after valid store writes and notification finish.
- Never let an older response clear or mutate a newer active run.
- Provide a retry action that re-reads the same terminal run result if result retrieval or parsing fails; retrying output hydration must not execute the cluster again.

### 7. Correct queued backtest completion ownership

- Treat batch `BacktestInit` started by a queued workflow/cluster run as owned by that outer run.
- Do not blindly add `await session.runAll()` while leaving the outer engine free to execute the same strategy nodes again.
- Define one orchestration path that:
  - prevents duplicate outer execution of strategy members already driven per bar by the backtest session;
  - awaits batch completion, finalization, and required persistence;
  - propagates background session failure or cancellation to the owning workflow run;
  - collects the final latest-per-node snapshots before session cleanup;
  - merges those snapshots into the owning run’s `nodeResults` and deterministic execution order;
  - preserves manual/individual stepping behavior, which must not await a full batch.
- Ensure compiled and dynamic-engine backtests expose equivalent latest-node snapshots.
- Mark the workflow run terminal only after the owned batch session has completed and its final snapshots are persisted.

### 8. Preserve partial results during cancellation

- Separate result persistence from terminal status transitions so available partial `nodeResults` can be saved even if the row has already moved to `cancelling` or `cancelled`.
- Never change a cancelled run back to success while persisting its partial result.
- Persist the cancellation outcome and any completed node snapshots atomically or with guarded updates that preserve the terminal status.
- Hydrate those partial results in the editor and mark remaining members not executed/cancelled as appropriate.

### 9. Keep the API and database change minimal

- Keep the existing authenticated status endpoint and `workflow_runs.result`; no new table is required.
- Replace accidental `select("*")` coupling with an explicit repository/query response contract only after checking all current status-endpoint consumers.
- Preserve workflow ownership checks and existing RLS protections.
- Retain established output-redaction rules. Selecting fewer run columns does not prove arbitrary node output is secret-free, so do not make that claim.
- Add a dedicated authenticated result endpoint only if terminal result size measurably makes one-second status polling too expensive; otherwise avoid extra API surface.

## Automated tests

### Result normalization and panel behavior

- Standard, legacy, raw, explicit-null, falsy, array, skipped, failed, and malformed sibling results normalize correctly without an extra `data` layer.
- Missing `executionOrder` no longer hides valid results in history or live hydration.
- An accepted rerun cannot fall back to stale `data.output`.
- A rejected save/execute request preserves previous results.
- Pinned outputs remain unchanged; unpinned outputs refresh.
- Unexecuted members receive the explicit not-executed state.

### Scope and race safety

- Only member IDs captured at submission are hydrated.
- Membership changes during execution do not expand the hydration scope.
- Wrong run, cluster, revision, session, synthetic ID, or stale generation results are ignored.
- A late cluster response cannot overwrite a newer individual-node result.
- Repeated terminal polls hydrate once, and a malformed sibling does not block valid members.
- Output-hydration retry updates the same run without starting another execution.

### Backend lifecycle and cancellation

- The status response exposes the explicit owned-run result contract and rejects cross-user access.
- Batch cluster backtests do not mark the owning workflow run successful before session completion/finalization.
- A background backtest failure produces a failed owning run rather than misleading success.
- Final `OnBar` output corresponds to the expected last processed bar.
- Compiled and dynamic-engine backtests produce equivalent panel snapshots.
- Strategy members are not executed both by the outer workflow and by the per-bar session.
- Cancellation after one node completes preserves its output, retains cancelled status, and does not resurrect execution.

## End-to-end acceptance

1. Run an expanded ordinary cluster and confirm each executed member panel changes from pending to its persisted output before the control settles on Completed.
2. Run the same cluster while collapsed, expand it after completion, and confirm identical outputs.
3. Collapse and re-expand after hydration and confirm outputs remain stable.
4. Run the shown BacktestInit/OnBar cluster and confirm Completed appears only after the backtest session finishes; BacktestInit shows initialization data and OnBar shows the expected final bar snapshot.
5. Force a downstream failure and confirm upstream outputs and the failed-node error are both visible.
6. Cancel after partial progress and confirm available outputs remain while the run stays Cancelled.
7. Pin one member, rerun, and confirm its pin survives while unpinned members refresh.
8. Start a run, change membership or navigate away, and confirm late results do not alter the new editor state.
9. Confirm execution history displays the same normalized values as the live panels.

## Completion criteria

- Every accepted cluster run gives each captured member a deterministic pending, result, error, skipped, cancelled, or not-executed panel state without reload.
- Ordinary cluster results and final batch-backtest snapshots are both represented accurately.
- The owning workflow cannot report success before its queued backtest finishes.
- Compact/expanded transitions, pins, rejected submissions, membership edits, stale responses, and newer executions cannot corrupt panel output.
- Partial cancellation results persist without changing the cancelled status.
- The implementation uses the existing persisted run result and requires no unnecessary database table or migration.
