# Show cluster execution results in member-node output panels

## Confirmed cause

- Cluster execution itself succeeds and persists its per-node outputs in `workflow_runs.result.nodeResults`, keyed by canonical node ID. The reported run contains results for `BacktestInit` and `OnBar`, plus `executionOrder` and boundary outputs.
- The same run has no rows in `node_executions`, so the existing `/runs/:runId/executions` endpoint cannot supply these results for this execution path.
- `useClusterExecution` already polls `/workflows/:workflowId/runs/:runId/status`. The backend status response includes the complete run row, including `run.result`, but the hook types and reads only `status` and `error_message`.
- Member output panels read from the live `ExecutionStore`. Cluster polling never copies `run.result.nodeResults` into that store or triggers its update notification, so panels retain their initial `pending` value.
- Collapsed members remain mounted as hidden runtime hosts, so compact/expanded rendering is not the cause; both views can receive the same store update.

## Implementation

### 1. Define one reusable persisted-result normalizer

- Extract the existing run-result interpretation used by execution history into a shared utility.
- Accept the persisted workflow result shape: `success`, `nodeResults`, `executionOrder`, timing, error information, and optional cluster boundary outputs.
- Normalize each node result into the same output shape used by direct node execution and `OutputPanel`:
  - preserve an existing `StandardNodeOutput` unchanged;
  - convert successful `{ success, data }` results into a visible success output;
  - convert failed results into a visible error output without losing the node error message;
  - retain legitimate falsy outputs such as `0`, `false`, `""`, `null`, and empty arrays;
  - treat a missing node result as “not executed,” not as an empty successful output.
- Reuse this utility in execution history so live cluster panels and historical panels cannot drift in formatting.

### 2. Hydrate the live execution store from the status response

- Extend the typed cluster status response to include `run.id`, `run.scope_kind`, `run.scope_cluster_id`, `run.source_workflow_revision`, and `run.result`.
- When polling reaches a terminal state, read `run.result.nodeResults` directly from the existing status response; do not fetch `/runs/:runId/executions`, because this engine currently persists results in the run JSON rather than that table.
- Batch-write normalized outputs with `executionStore.setNodeData(nodeId, { output })` and call the shared store notification once after the batch.
- Apply available terminal results for `success`, `failed`, and `cancelled` runs so partially executed nodes show their real output or error instead of remaining pending.
- Mark only the cluster control as completed/failed after result hydration has been attempted, ensuring the visible run state and node panels transition together.

### 3. Restrict updates to the exact cluster run

- Pass a canonical member-ID resolver from `WorkflowEditor` into `useClusterExecution`; derive it from saved cluster metadata, never from projected compact-node IDs.
- Before writing any output, verify:
  - the response run ID matches the active run;
  - the workflow editor session has not changed;
  - `scope_kind` is `cluster`;
  - `scope_cluster_id` matches the cluster being polled;
  - each result key belongs to that cluster’s canonical `memberNodeIds`.
- Ignore unrelated, malformed, synthetic display, and out-of-scope node IDs so one cluster run cannot overwrite another node’s panel.
- Preserve pinned outputs through the existing `ExecutionContext.setNodeData` behavior; a cluster result must not replace a user-pinned value.

### 4. Handle lifecycle and race conditions

- Before submitting a new run, clear stale unpinned runtime outputs for that cluster’s members and notify once, so old results are not displayed as the new run’s output.
- Do not clear pinned outputs.
- Use a per-run hydration guard so repeated terminal polls cannot apply the same result multiple times.
- Keep `activeRef` valid until terminal hydration finishes; only then release it for another run.
- Discard late status/results when the workflow session changes, the editor navigates to another workflow, or a newer run supersedes the request.
- If a terminal response has no valid `nodeResults`, keep the run’s completed/failed status but surface a non-destructive cluster-level reason such as “Run completed without node output,” rather than fabricating node output.
- A transient polling or malformed-result error must not erase existing panel data or incorrectly change a successful backend run into a failed execution.

### 5. Keep compact and expanded behavior identical

- Write results only by canonical member node ID in the shared live store.
- Do not write output onto the synthetic compact cluster node.
- Confirm that results received while collapsed appear immediately after expansion, and results received while expanded remain available after collapse/re-expand.
- Keep cluster view state presentation-only; expanding or collapsing must neither clear nor duplicate output hydration.

### 6. Backend contract and payload safeguards

- Keep the current `workflow_runs.result` persistence as the authoritative result source for scoped workflow runs; no database migration or new table is required.
- Add an explicit response type/schema for the status payload so `run.result` is intentional rather than an accidental consequence of selecting `*`.
- Prefer a narrowly selected status response containing only fields needed by polling plus the terminal result. If payload size is a concern, return `result` only for terminal states or add a dedicated authenticated run-result endpoint backed by `workflow_runs.result`; do not switch to `node_executions` until the engine actually writes those records.
- Preserve the existing workflow ownership check and RLS protections. Never include credentials, decrypted secrets, or saved node configuration in the output hydration payload.

## Automated tests

### Frontend unit tests

- A successful terminal status with two member results writes both normalized outputs and sends one store notification.
- Failed and cancelled runs hydrate any partial node results before exposing the terminal cluster state.
- Results for nodes outside `memberNodeIds`, synthetic compact IDs, the wrong cluster, wrong run, or stale workflow session are ignored.
- Pinned outputs remain unchanged while unpinned outputs update.
- Falsy and empty result values render correctly rather than falling back to pending.
- Repeated terminal polls hydrate once; a newer run cannot be overwritten by an older response.
- A terminal run without `nodeResults` keeps node panels unchanged and exposes the cluster-level no-output reason.

### Shared normalization tests

- Standard outputs, legacy `{ success, data, error }` outputs, raw values, explicit null, and node errors normalize consistently.
- Live cluster hydration and execution-history rendering use the same normalization contract.

### Backend contract tests

- An owned cluster run status response exposes the expected scope identifiers and persisted terminal result.
- A user cannot read another user’s run result.
- Successful, failed, and cancelled runs retain partial or complete `nodeResults` when available.
- The status/result response does not expose workflow credential fields or decrypted credential data.

### Browser acceptance

1. Expand a cluster containing at least two nodes and open their output panels.
2. Run the cluster and confirm panels move from pending to each node’s actual output when the control reaches Completed.
3. Collapse during a run, wait for completion, expand, and confirm the same outputs are present.
4. Run while expanded, collapse and re-expand, and confirm outputs persist.
5. Force a downstream failure and confirm completed upstream nodes retain outputs while the failed node shows its error.
6. Pin one member’s output, rerun the cluster, and confirm the pin remains while other member outputs refresh.
7. Start a run, navigate to another workflow before completion, and confirm the late response changes no panel in the new workflow.
8. Open the execution-history view and confirm it displays the same values as the live panels.

## Completion criteria

- A completed cluster run updates every executed member node’s live output panel without a page reload.
- Partial results remain visible after failed or cancelled runs.
- Compact and expanded cluster views show identical persisted results.
- Pinned outputs, unrelated nodes, newer runs, and other workflow sessions cannot be overwritten.
- The implementation uses `workflow_runs.result.nodeResults`, matching the data currently persisted by the worker, with no unnecessary database migration.
