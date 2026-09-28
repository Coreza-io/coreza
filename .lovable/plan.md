# Fix collapsed-cluster inputs and harden cluster result delivery

## Goal

Make cluster collapse a presentation-only change. A downstream node must expose the same real upstream nodes, selected source, data, and dragged field references whether the cluster is expanded or collapsed. Cluster polling, retries, cancellation, and terminal output hydration must also remain correct across reruns, supersession, navigation, and partial execution.

## Confirmed current state

At the reviewed commit `5e16e6a90bf0add47f4dff348201c450b591aabb`:

- Terminal cluster results are already read from `workflow_runs.result.nodeResults`, normalized, written to the live execution store, and published to member output panels.
- Submitted runs already capture workflow, session, run, cluster, revision, member IDs, and execution generation; pins and falsy values are protected in the main output path.
- Batch BacktestInit already awaits `session.runAll()`, collects latest member snapshots, suppresses duplicate outer routing, and carries snapshots through its failure result.
- The status repository already selects explicit run identity, scope, revision, snapshot, status, error, and result fields. Existing `workflow_runs` scope columns, constraints, grants, and indexes are sufficient for the base feature.
- `InputPanel` still reads React Flow’s projected display nodes and edges. Collapsing removes internal cluster edges and rewrites boundary endpoints to a synthetic compact-node ID, so ancestry, selection, data lookup, and dragged reference provenance become incorrect.
- The existing canonical graph context is imperative and ref-backed; it cannot reactively notify InputPanel when topology changes.
- Cluster polling restarts whenever UI state changes, stale execution generations can leave controls locked, retry hydration can write into a replaced workflow session, and missing result payloads are conflated with legitimately unexecuted members.
- Existing tests cover projection/runtime-host behavior and result normalization, but not the real InputPanel, polling lifecycle, terminal hydration, or owned backtest execution.

## Implementation plan

### 1. Establish one reactive canonical graph source

**Primary files:** `src/contexts/StableNodeContext.tsx`, `src/pages/WorkflowEditor.tsx`

- Extend the existing stable-node provider instead of adding a second competing graph owner.
- Keep the current imperative `getNodes`, `getEdges`, and `getNodeById` API for execution callbacks.
- Add a subscription-based canonical snapshot API, implemented with a stable external-store pattern such as `useSyncExternalStore`:
  - snapshot contains canonical `nodes` and `edges`, never compact display nodes or projected edges;
  - snapshot identity changes only when the canonical document changes;
  - subscribers are notified after a committed canonical update, not unconditionally during render;
  - workflow replacement, node/edge add, delete, reconnect, and semantic node metadata changes publish a new snapshot;
  - collapse/expand and compact-cluster movement do not alter the canonical snapshot;
  - historical/read-only canvases remain isolated from the live editor snapshot.
- Replace the current render-time ref mutation with a commit-safe synchronization path. Avoid a provider update loop and avoid publishing an intermediate workflow where nodes and edges belong to different revisions.
- Expose a `useCanonicalGraphSnapshot` hook with a clear failure mode outside the provider.
- Preserve array/object identity between unchanged snapshots so consumers and ancestry indexes can memoize reliably.
- Separate topology identity from position-only changes where practical: ancestry should rebuild for endpoint/handle/node-membership changes, not every drag frame. If a separate topology revision is introduced, include node metadata changes needed for labels/data lookup without invalidating the edge index unnecessarily.

### 2. Make InputPanel use canonical semantics

**Primary files:** `src/utils/InputPanel.tsx`, optionally a small pure helper under `src/utils/`

- In live editor mode, obtain nodes and edges from the canonical snapshot, not `useReactFlow().getNodes()` or `getEdges()`.
- In historical/read-only mode, continue using the supplied saved nodes, saved edges, execution inputs, and execution records; do not attach historical panels to the live editor document.
- If unconditional hook rules make the dual mode awkward, split live and historical data adapters around one presentational panel.
- Use canonical nodes and edges for all semantic decisions:
  - all-upstream traversal;
  - direct Loop `done`-edge preference;
  - selected source validation;
  - source-node metadata and output fallback lookup;
  - field-reference provenance.
- Retain all upstream ancestors in deterministic traversal order. Do not reduce the list to direct predecessors.
- Include only truly reachable ancestors. Do not expose unrelated members merely because they share a cluster.
- Do not attempt to repair only projected boundary endpoints: collapsed projection omits internal edges, so that cannot reconstruct complete ancestry.
- Do not mask the defect by renaming the synthetic option. Synthetic display nodes must never enter semantic input selection.

### 3. Repair stale source selection deterministically

**Primary file:** `src/utils/InputPanel.tsx`

- Extract a pure selection resolver and apply this priority whenever the target node or canonical upstream set changes:
  1. preserve `selectedPrevNodeId` if it remains a canonical upstream ID;
  2. otherwise choose an eligible direct incoming Loop `done` source;
  3. otherwise choose the first node in the existing deterministic upstream traversal order;
  4. otherwise clear the selection.
- Call `setSelectedPrevNodeId` only when the resolved value differs, preventing effect loops.
- Repair selection after disconnect, edge replacement, node deletion, workflow replacement, or a previously stored synthetic ID.
- Do not reject IDs by prefix alone. Projection supports collisions with the reserved prefix; validity must come from canonical membership and the display-node mapping/type, not string heuristics.
- Repeated collapse/expand, cluster rename, or compact-card movement must preserve a still-valid canonical selection.

### 4. Make selected input data reactive and presence-safe

**Primary files:** `src/utils/InputPanel.tsx`, `src/contexts/ExecutionStoreContext.tsx` only if a narrower subscription is needed

- Subscribe InputPanel to execution-store changes with the existing version hook, or add a node-scoped subscription if broad updates are measurably expensive.
- Recompute the displayed input after cluster terminal hydration without requiring the user to close, move, collapse, or reopen a node.
- Resolve live data by property presence, not `??` or truthiness:
  1. if the execution-store record owns `output`, use it exactly;
  2. else if the canonical node data owns `output`, use it exactly;
  3. else use canonical node `input` only where that fallback remains part of the existing contract;
  4. otherwise show the empty state.
- Preserve explicit `null`, `0`, `false`, `""`, arrays, and empty objects. An explicit current output must never fall through to stale node data.
- Keep pinned output authoritative through the existing store behavior.
- Apply equivalent property-presence handling to read-only execution values where needed, without coupling history to the live store.

### 5. Guarantee canonical dragged references

**Primary files:** `src/utils/InputPanel.tsx`, `src/utils/DraggableFieldsPanel.tsx`, relevant reference tests

- Keep the existing structured drag payload and path-segment handling.
- Ensure `sourceNodeId` always comes from the repaired canonical selection.
- Assert that expanded and collapsed panels produce the same expression for the same field, including nested objects and arrays.
- Never serialize a compact cluster display ID into a new field reference.
- Preserve existing saved expressions unchanged during collapse/expand; this work changes selection/provenance, not stored expressions.

### 6. Refactor cluster execution into descriptor-owned operations

**Primary file:** `src/hooks/useClusterExecution.ts`, with pure lifecycle helpers extracted where useful

- Replace the `states`-dependent polling effect with a poller owned by one immutable accepted-run descriptor.
- Track active polling through a descriptor/session token or reducer event model, not by closing over the full UI state map.
- Permit exactly one status request in flight for an owned run.
- Start the next cancellable delay only after the previous nonterminal request settles; UI phase/warning updates must not restart polling or bypass the configured interval.
- Store and clear both request abort controllers and delay timers on terminal completion, unmount, workflow replacement, supersession, and retry completion.
- After every await, verify workflow session, run, cluster, revision, submitted membership, and execution generation before mutating the store, warnings, controls, refs, or submission locks.
- Define one descriptor-scoped cleanup operation that:
  - clears only the matching active descriptor;
  - releases queued/running/cancelling controls when ownership is superseded;
  - cannot clear a newer run accepted for the same cluster;
  - leaves a deterministic final UI state such as idle/blocked rather than a permanently active phase.
- Add a submission ownership token so an older `prepare`/execute request’s `catch` or `finally` cannot clear the lock or state of a newer session.
- Keep pending-output reset after server acceptance only. Save failures and rejected execute requests must retain the previous useful output.
- Continue hydrating only the immutable member IDs captured from the saved submitted revision and still present in the current editor.

### 7. Make retry hydration session-safe

**Primary file:** `src/hooks/useClusterExecution.ts`

- Keep “Retry output” as a GET/read of the same terminal run. It must never submit another execution.
- Give retry its own immutable descriptor/session token and AbortController; do not temporarily reuse `activeRef` in a way that blocks or aliases a new execution.
- Validate ownership after the request and before hydration, warning updates, retry-state updates, and cleanup.
- Abort retry on workflow replacement/unmount and ignore every late success or failure from the old session.
- Prevent duplicate retry clicks from creating competing hydrations; either reuse one in-flight promise or reject the duplicate without changing the run state.
- Preserve the terminal execution outcome while updating only output-availability state.

### 8. Define an explicit terminal-result completeness contract

**Primary files:** `coreza-backend/src/engine/types/executionError.ts`, `coreza-backend/src/engine/workflowRun.ts`, `coreza-backend/src/utils/workflowWorker.ts`, `coreza-backend/src/workflow/WorkflowRunRepository.ts`, `coreza-backend/src/workflow/WorkflowQueryService.ts`, `src/hooks/useClusterExecution.ts`, `src/utils/persistedNodeResult.ts`

- Treat run outcome and result availability as separate concepts.
- Extend the persisted result envelope or typed status response with an explicit finalization/completeness contract. At minimum it must identify:
  - whether result production is finalized;
  - canonical executed/skipped/cancelled node IDs, or an equivalent per-member outcome map;
  - available `nodeResults` and deterministic `executionOrder`;
  - partial-result state for failure/cancellation.
- Prefer extending the existing `workflow_runs.result` JSON contract and status response; do not create a new table. Add a database column/migration only if atomic durable finalization cannot be represented safely in the existing result JSON.
- Define behavior precisely:
  - missing or malformed entire result envelope: preserve pending/current-run authority, show “output unavailable,” and allow retry;
  - finalized result with explicit skipped/unexecuted/cancelled member outcome: render that exact marker;
  - partial finalized failure/cancellation: show available member snapshots and explicit outcomes for the rest;
  - non-final terminal observation caused by a persistence race: keep polling with a bounded timeout/backoff before showing retryable unavailability;
  - empty but finalized execution: valid only when the explicit outcome metadata accounts for the submitted scope.
- Never infer completeness from object truthiness, terminal status alone, or the assumption that every cluster member must execute; conditional branches may legitimately omit execution.
- Keep malformed sibling entries isolated so valid member results still hydrate.
- Preserve shared normalization and history parity.

### 9. Close cancellation/result finalization races

**Primary files:** `coreza-backend/src/workflow/WorkflowExecutionService.ts`, `coreza-backend/src/workflow/WorkflowRunRepository.ts`, `coreza-backend/src/infra/jobQueue/jobQueueManager.ts`, `coreza-backend/src/utils/workflowWorker.ts`, `coreza-backend/src/utils/redisRunStorage.ts`

- Preserve the current independent snapshot write, but make terminal finalization ownership explicit across database and Redis paths.
- Change run cancellation to distinguish queued jobs removed before start from active jobs receiving an abort signal:
  - queued/removed runs can persist a finalized empty cancelled result and then become cancelled;
  - active runs remain cancelling until the owning worker captures available snapshots and finalizes the cancelled result/status;
  - already-terminal and worker-completed races return the actual durable state without overwriting it.
- Prevent a cancellation endpoint from marking an active run terminal before the worker’s final snapshot write is complete.
- Persist result/finalization before, or atomically with, the guarded terminal status transition. A cancelled run must never return to success.
- Make Redis and Supabase paths expose equivalent result/finalization semantics; ensure Redis-to-database synchronization retains all new envelope fields.
- Preserve ownership checks, service-role writes, authenticated read-only access, existing scope validation, and output-redaction rules.
- Verify all status endpoint consumers before changing its response type. Keep the current endpoint unless payload-size measurement proves a dedicated result endpoint is needed.
- No new table is expected. If a schema change becomes necessary, add a migration with explicit grants and update generated types/schema mirrors in the same change.

### 10. Validate owned BacktestInit execution end to end

**Primary files:** `coreza-backend/src/backtest/BacktestExecutor.ts`, `coreza-backend/src/backtest/session/BacktestSession.ts`, `coreza-backend/src/engine/executionRuntime.ts`, `coreza-backend/src/engine/workflowRun.ts`, `coreza-backend/src/utils/workflowWorker.ts`

Keep the implemented awaited-batch design, then prove these contracts rather than rewriting it without evidence:

- Compiled and dynamic paths both await the owned batch, finalize it, and expose equivalent latest-per-node snapshots.
- BacktestInit and OnBar snapshots merge into the outer run exactly once and in deterministic order.
- `suppressRouting` prevents the outer workflow runtime from executing strategy members a second time.
- A per-bar failure returns a failed owning run while retaining completed snapshots.
- Cancellation works before worker start, before/while session initialization, and mid-batch.
- If the parent signal is already aborted when the session listener is attached, cancel immediately; do not rely solely on a future abort event.
- Manual stepping retains its existing non-owned lifetime and does not await a full batch.
- Cluster boundary isolation prevents an external downstream node from executing during the scoped run.
- Session cleanup and listener removal occur once on success, failure, and cancellation.

### 11. Add focused automated coverage

**Frontend unit/component tests**

- Canonical graph subscription publishes topology/workflow replacement and remains stable for unchanged snapshots.
- Expanded and collapsed `BacktestInit → OnBar → Consolidator` produce `OnBar, BacktestInit` in the same deterministic order.
- Endpoint repair without internal edges is explicitly proven insufficient.
- Multiple boundary edges preserve distinct real sources and deduplicate ancestors.
- An unrelated member in the same cluster is excluded.
- Two connected collapsed clusters expose all and only actual canonical ancestors.
- Twenty collapse/expand cycles preserve a valid selected ID, data, and expression provenance.
- Disconnect/delete repairs selection by the defined priority or clears it.
- Loop `done` preference uses canonical handle semantics.
- Cluster hydration updates an already-open downstream InputPanel while collapsed.
- `0`, `false`, empty string, `null`, arrays, and empty objects render exactly; no stale fallback occurs.
- Pins remain authoritative.
- Drag payloads never contain synthetic display IDs.
- Historical panels use their saved graph/results and ignore live collapse state.

**Cluster hook tests with fake timers and deferred promises**

- Repeated running responses cannot exceed one request per configured delay and never overlap.
- Terminal hydration occurs once and notifies the store once per accepted payload batch.
- Accepted scope is immutable across membership changes.
- Wrong workflow, session, run, cluster, revision, membership, synthetic ID, or generation is ignored.
- Supersession releases the old controls without clearing the newer run.
- Workflow switch/unmount aborts poll and retry; late responses produce no state/store writes.
- Old submission `finally` cannot unlock or overwrite a newer submission.
- Retry reads the same run once and never calls execute.
- Missing, malformed, incomplete, partial, empty-finalized, skipped, cancelled, and complete terminal payloads produce distinct expected UI/store states.
- Rejected save/execute preserves prior outputs; accepted run creates pending markers only for submitted unpinned members.

**Backend integration tests**

- Authenticated owner can read the explicit run contract; cross-user access is rejected.
- Database and Redis status paths return equivalent metadata/result-finalization semantics.
- BacktestInit + OnBar cluster success persists both final snapshots and does not become successful early.
- Compiled and dynamic paths produce equivalent latest snapshots.
- Failure preserves completed snapshots and a failed status.
- Cancellation before start, during initialization, and mid-batch preserves correct partial output and remains cancelled.
- Already-aborted signals cancel the owned session immediately.
- Manual stepping is unchanged.
- External Consolidator is not executed by the scoped cluster run.

**Browser acceptance using the real editor/InputPanel**

1. Build `BacktestInit → OnBar → Time Bar Consolidator`, group the first two nodes, and open the Consolidator Input Data panel.
2. Verify expanded options are exactly the real OnBar and BacktestInit IDs in deterministic order.
3. Collapse the cluster and verify the same options, selected source, values, and field references without reopening the panel.
4. Rename and move the compact cluster; verify semantic input state is unchanged.
5. Repeat collapse/expand 20 times; verify no synthetic ID appears and no selection/data drift occurs.
6. Disconnect/delete the selected source and verify deterministic repair.
7. Run while collapsed; verify pending then terminal member outputs appear without manual refresh, and expanding shows identical output.
8. Verify failure, cancellation, retry-output, pinning, workflow navigation during an in-flight request, and a newer individual-node execution cannot be overwritten by the old cluster run.

### 12. Verification and release gates

- Run focused frontend unit/component tests, then the full frontend test suite and lint/type checks used by the repository.
- Run focused backend Jest integration tests, then backend build, lint, and module-boundary validation.
- Run the real Playwright regression, not only the static collapse fixture.
- Inspect request timing to confirm one non-overlapping status request per interval.
- Verify database migrations/schema mirrors and grants only if Step 9 requires a schema change.
- Re-run the Docker build-and-scan job. The reviewed CI failure was an out-of-memory exit during the frontend Docker build, not a proven feature TypeScript error; adjust CI/build memory or chunking only after reproducing and measuring it, then obtain a passing check.

## Delivery order

1. Reactive canonical graph API and InputPanel ancestry/selection/data/reference correctness.
2. Descriptor-owned polling, retry, submission, supersession, and cleanup.
3. Explicit result completeness plus cancellation finalization parity across database and Redis.
4. Owned backtest integration coverage and real browser acceptance.
5. Full checks and CI rerun.

## Completion criteria

- Collapse/expand changes presentation only; upstream options, selection, displayed data, and expressions remain identical and canonical.
- No compact display ID can enter InputPanel selection, output lookup, or a serialized field reference.
- Every accepted member has a deterministic pending, success, error, skipped, cancelled, not-executed, or retryable-unavailable state without reload.
- Polling has one owned request at a time, respects its delay, and cannot leave controls locked or mutate a replaced workflow.
- Retry never re-executes; pins and newer executions cannot be overwritten.
- The owning run cannot report finalized success/cancellation before owned batch work and available snapshots are durably finalized.
- Expanded/collapsed, conditional, failure, cancellation, history, compiled/dynamic backtest, and workflow-switch cases pass automated tests.
- Frontend/backend checks, the real browser regression, and CI build-and-scan pass.
