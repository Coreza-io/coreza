# Implement reliable cluster-scoped execution

## Review conclusion

The attached recommendation has the right central architecture: **Execute cluster must be a backend-scoped manual run over canonical member nodes**, not a loop around the editor’s existing node buttons and not a second scheduler. The server must derive membership from the saved workflow revision, stop routing at cluster boundaries, and preserve ordinary node/branch/loop semantics inside the scope.

The latest implementation review is valid for its pinned main revision (`3faac7ac6ca2f525e14969d5ceff1e9ddc2e3ad2`): it correctly concludes that PR #760 is backend foundation work, not an end-to-end feature, and that adding only a play icon would expose correctness defects. Those newer backend files are not present in this checkout (`5c0e0aebcd2df2cfb22b9d4af5ccfc3b4522ddd6`), so the implementation must first align to the intended branch and preserve the already-added planner/scope/cache/migration work rather than recreating it blindly.

Current-checkout facts verified independently:

- `CLUSTER_COLLAPSE_ENABLED` is still `false`.
- Compact nodes are still `draggable: false`; the referenced position/selection helper files are absent.
- The compact renderer has no execution footer and still derives status from member node data.
- Frontend Execute All still depends on mounted node components and a `WorkflowExecutor` memoized by node/edge counts.

Treat the attachment’s drag/theme work as belonging to its pinned newer revision, not as completed in this workspace. Preserve or merge those changes when the implementation branch is aligned, but do not rebuild them as part of cluster execution.

The current backend does provide useful foundations: authenticated workflow routes, revision-checked manual execution, canonical run snapshots, `WorkflowPlan`/`WorkflowRun`, `executeFromEntries`, `AbortSignal`, and an existing `cancelWorkflowRun(runId)` queue method. However, this checkout has no cluster execution request schema/service path, the cancel method is not in the queue interface or authenticated HTTP API, and its current scan only finds jobs whose own `runId` matches; it does not guarantee cancellation of distributed loop descendants.

The implementation order is mandatory: establish the actual PR #760 source/build baseline, repair the blocking runtime contracts, then expose the shared frontend control. The control may be developed behind a disabled capability gate, but unrestricted execution must not ship before pins, branch joins, loops, reference context, cancellation, and truthful completion pass their gates.

## Product contract

Add one shared **Execute cluster** action to the bottom of the compact card and expanded frame.

- The cluster remains collapsed or expanded while running.
- Execute only the saved canonical members of the selected cluster.
- Run internal main connections with normal dependency, If/Switch, and supported Loop behavior.
- Keep attachment/tool dependencies available to their owner but never schedule them as ordinary roots.
- Read approved external input/reference snapshots without executing external nodes.
- Stop at outgoing cluster boundaries and expose boundary results in run details without mutating or executing downstream nodes.
- Use a pinned member’s value without invoking its action.
- Fail before starting if required boundary input, credentials, configuration, or execution context is missing.
- Initial release is finite manual execution, fail-fast, and one editor execution at a time. Trigger, live-stream, scheduled, and backtest contexts are explicitly ineligible unless separately supported.
- A cluster run is independent of visual state, card position, zoom, or projected display IDs.

## Phase 0 — Align source, schema, and test baselines

1. Confirm the target branch/SHA that contains PR #760 and the user’s working drag/theme implementation. Diff its cluster planner, scoped worker, cache key, cancellation route, migrations, and tests against this checkout; retain those changes as the starting point. Do not enable collapse in this older checkout merely to expose the button.
2. Repair and verify the exact target revision’s build gate: correct the reported Docker build-context path and invalid `readonly Array<T>` annotation if they still exist, then run backend typecheck/build and focused tests. Treat the uploaded CI report as evidence about its pinned revision, not proof of the current checkout.
3. Verify the deployed database before coding. The connected schema currently does not expose `workflow_runs.source_workflow_revision`, although repository code writes it and a local migration exists. Verify the PR #760 scope migration was actually applied rather than inferring deployment from source files.
4. Record frontend/backend version identifiers in diagnostics so the compact screenshot, API contract, and database migration can be tied to one release.
5. Add failing deterministic fixtures for:
   - a three-member action chain;
   - external predecessor and successor;
   - If/Switch with a join;
   - sequential and distributed Loop;
   - pinned member and attachment dependency;
   - missing boundary data, failure, cancellation, and revision conflict.
6. Record current whole-workflow execution behavior so scoped changes cannot regress scheduled, live, or backtest execution.

Exit: one known source revision, deployed schema facts, and reproducible failing scoped-run tests.

## Phase 1 — Define shared scope and result contracts

Introduce backend-owned discriminated contracts:

```text
ExecutionScope =
  | { kind: "workflow" }
  | { kind: "cluster"; clusterId: UUID }

ClusterRunRequest = {
  expectedRevision: integer
  scope: { kind: "cluster"; clusterId: UUID }
  idempotencyKey: UUID
  boundaryInputs?: edgeId -> JSON value
  referenceSnapshots?: nodeId -> approved JSON value
}
```

The client may identify a cluster and supply bounded input snapshots, but it must not submit member IDs, executable nodes, internal edges, projected IDs, a plan hash, or an arbitrary user ID. Ownership always comes from `req.user?.id`; membership and graph content always come from the server-loaded saved revision.

Define structured preflight errors with stable codes and affected cluster/node/edge IDs, including: cluster missing, revision conflict, invalid saved cluster, unsupported execution context, missing boundary input, invalid reference snapshot, unsupported cycle, missing credentials, and empty executable scope.

Define terminal member outcomes: `succeeded`, `failed`, `cancelled`, `pinned`, `branch_skipped`, `dependency_blocked`, and `attachment_only`. Queue exhaustion is not success while a required executable member remains unresolved.

## Phase 2 — Build a pure server-side cluster planner

Create a backend planner that receives the owned workflow snapshot plus `clusterId` and returns an immutable execution plan:

```text
ClusterExecutionPlan = {
  workflowId, sourceRevision, clusterId, titleSnapshot
  memberNodeIds, executableNodeIds, attachmentNodeIds
  internalMainEdges, internalAttachmentEdges
  boundaryInputEdges, boundaryOutputEdges
  entryActivations, referenceContext, pinnedResults
  executionMode: "manual", failurePolicy: "fail-fast"
  planHash
}
```

Planner rules:

1. Reuse the authoritative backend cluster-document validator first, then add execution eligibility checks; visual topology validity alone is not execution readiness.
2. Classify edges by canonical handle semantics. Reject unknown semantics and attachment boundaries.
3. Permit the current single entry member while preserving each incoming boundary edge’s ID, handles, source, and payload provenance. Multiple boundary edges to that one member are not one interchangeable input.
4. Derive internal roots only after supplied boundary activations are accounted for. Action-only clusters must not depend on trigger-root discovery.
5. Keep outgoing boundary edges as result descriptors only; exclude external targets from scheduling.
6. Keep attachment nodes in the scoped plan for owner resolution, but exclude them from root scheduling.
7. Read pins through the canonical top-level `pinnedOutput` representation used by workflow serialization. Use one shared accessor/normalizer; do not add `values.pinned` or a second persisted format. Preserve result envelopes and falsy values.
8. Detect accepted Loop topology explicitly and reject all other cycles. A valid standalone `Loop → Body → Loop` scope must receive an explicit initial activation or fail preflight; it must never compile to an empty queue and report success.
9. Resolve normalized node definitions/defaults server-side and reject members requiring unsupported streaming, trigger, scheduled, or backtest contexts. Delegate credential authorization to the existing secure credential path and return member-specific preflight diagnostics.
10. Include approved external reference definitions—canonical IDs and display names—separately from executable membership, so `$("Display name")` resolution works without making the external node schedulable.
11. Create a stable plan hash from workflow revision/content, cluster membership, relevant graph/configuration, execution mode, and planner version.
12. Cap snapshot size/depth and reject dangerous keys before queueing.

Exit: pure planner tests prove deterministic plans for chain, branch, loop, boundary, attachment, pin, and malformed-scope fixtures.

## Phase 3 — Make canonical inputs and pins explicit

Before submitting a run, the frontend coordinator must:

1. Finish any active position gesture.
2. Flush pending field edits into canonical nodes; debounce may delay persistence/history, but it cannot be the ownership boundary for executable values.
3. Save dirty/new workflows through the revision-aware backend path.
4. Use the workflow ID and revision returned by that exact save.
5. Freeze explicit boundary inputs and reference snapshots for this run.

Backend input rules:

- Distinguish “not supplied” from valid `false`, `0`, `""`, `[]`, and permitted `null`.
- Validate each boundary input against its canonical edge and target handle.
- Preserve separate payloads when several boundary edges target the entry member; use the same node input-selection/merge adapter as normal execution rather than priming every incoming edge with one value.
- External expression references live in a read-only context store. They are not graph members, execution-order entries, or successful node executions.
- Persist provenance as `explicit`, `pinned_upstream`, or `editor_snapshot`. Do not describe browser-only data as server-verified history.
- Move pin ownership to canonical saved/runtime state. A pinned member short-circuits before executor invocation, records `pinned`, and routes its value normally.

Exit: edit → immediately run uses the saved value, and missing/incompatible boundary context blocks before side effects.

## Phase 4 — Extend the existing engine with bounded execution

Do not create a cluster-only scheduler. Extend `WorkflowPlan`/`WorkflowRun`/runtime with a scoped plan and explicit activations.

1. Add an `executeFromActivations()` entry accepting per-entry input packets instead of one blanket input for every entry.
2. Add a context-seeding method that makes external snapshots available to parameter resolution without adding them to `executionOrder`.
3. Enforce `allowedExecutableNodeIds` in all three places: enqueue, execute, and route. Treat an attempted out-of-scope route as a runtime invariant failure, except declared boundary outputs which are captured and stopped.
4. Add explicit pinned-node short-circuiting before executor lookup/invocation.
5. Correct conditional join readiness with activation-aware branch tokens—not a simple group-by-origin If ID. Untaken branch handles are excluded, but every required fan-out path inside each selected branch plus every independent incoming dependency remains required. Cover nested conditions, multiple selected Switch outputs, unequal path lengths, and loop-iteration identity.
6. Record untaken conditional paths as `branch_skipped`; propagate upstream failures/cancellation as `dependency_blocked`/`cancelled` rather than silently succeeding.
7. Pass immutable scope metadata through `NodeExecutionContext` and every continuation.
8. Record boundary output only when its exact source handle fires; preserve edge/handle and activation identity. Never synthesize outputs for untaken If/Switch exits from the source node’s generic result.
9. For distributed Loop jobs, propagate parent run ID, cluster ID, allowed IDs, scope/plan hash, revision, pins, reference context, boundary descriptors, fail-fast policy, and cancellation lineage to child, aggregator, and done-continuation jobs. Filter extracted subgraphs and done edges to the allowed scope/boundary contract, and check `result.success` in every worker branch.
10. Add a durable descendant-completion barrier. Keep the root run non-terminal until required children, aggregation, continuation, and boundary-output finalization settle. If this cannot ship in the first release, reject parallel Loop clusters at preflight instead of reporting premature success.
11. Finalization must account for every executable/attachment member outcome; an empty queue or unresolved required member is not successful completion.
12. Use a fresh execution-scoped store and abort signal for each run.

`EnginePool` currently caches only by `workflowId:executionMode`; this can reuse stale graph/configuration even for ordinary revisions. Key it by tenant/workflow, source revision or content hash, execution mode, and scope/plan hash. Safest first release: bypass the cache for cluster runs, then add the complete key with isolation tests.

Exit: expanded/collapsed execution is identical; no external node can be queued; branch joins, loops, pins, failures, and cancellation are deterministic.

## Phase 5 — Add API, queue, cancellation, and idempotency

Extend `POST /workflows/:workflowId/execute` with the discriminated optional scope while preserving omitted-scope whole-workflow requests.

Server sequence:

1. Parse and validate the request.
2. Load the owned workflow with `req.user?.id`.
3. compare `expected_revision` with the saved revision;
4. compile and validate the cluster plan;
5. create or return the idempotent run after comparing a normalized request fingerprint;
6. enqueue the prepared scoped job;
7. if enqueue fails, atomically mark that run failed and release its execution lock.

Add `POST /workflows/:workflowId/runs/:runId/cancel`. Verify ownership and that the run belongs to the workflow before calling a queue-interface `cancelWorkflowRun(userId, workflowId, runId)`. Persist root-run cancellation intent first; workers check it before start, before descendant creation, and before success. Cancel queued/active roots plus descendants by root identity. Return `cancelling` until active workers acknowledge termination; do not claim `cancelled` merely because a one-time queue scan found a job or swallowed an adapter failure. Cancellation is idempotent and terminal-state guarded so late success cannot overwrite it.

Extend `WorkflowJobData` with a discriminated scope, prepared entry activations, plan hash, source revision, root run ID, and failure policy. Do not pass client-authored member arrays. Preserve scope on retries and continuations.

Use one synchronous editor execution lock shared by Execute All, Execute cluster, single-node execution, and Stop. A rapid double activation reuses the same idempotency key/run rather than duplicating side effects. Persist a normalized request fingerprint with the key; reuse returns the existing run only for the same scope, revision, inputs, and references, while mismatched reuse returns conflict. A legitimate retry may retrieve its matching run even if the workflow revision advanced after the original enqueue.

## Phase 6 — Persist truthful run scope and progress

Apply one migration to `workflow_runs` for the deployed schema, using additive nullable/defaulted fields compatible with existing rows:

- `source_workflow_revision bigint` if still absent;
- `scope_kind text NOT NULL DEFAULT 'workflow'`;
- `scope_cluster_id uuid`;
- `scope_snapshot jsonb NOT NULL DEFAULT '{}'` containing title/member IDs/plan hash/boundary provenance;
- `idempotency_key uuid` with an appropriate partial unique index per owned workflow/run initiator.

Use a validation trigger—not a time-dependent check—to enforce workflow-vs-cluster field consistency. Preserve existing table grants/RLS, but verify browser clients cannot directly forge run status: authenticated users need read access, while run creation/status mutation should remain backend-authoritative. Refresh generated database types from the deployed schema rather than hand-editing generated files.

Persist the complete canonical workflow nodes, edges, clusters, source revision, and a separate scope snapshot with every run. Do not store only scoped nodes beside all workflow clusters, which creates dangling historical membership. Never persist a compact display node or proxy handle as executable content.

Add a runtime event sink that writes per-activation node progress to `node_executions` with run/node identity, status, input/output/error, timestamps, loop activation metadata, and monotonic ordering. Batch or throttle writes where needed, but do not derive live cluster status from inconsistent node `data` flags. Historical cluster runs must remain identifiable after rename, move, collapse, or dissolve.

Exit: run history distinguishes workflow and cluster runs, reports honest member outcomes, survives reload, and cannot be forged through the browser.

## Phase 7 — Build one frontend cluster-run coordinator

Add a coordinator above the projected canvas, not inside member renderers. It owns:

- `executeCluster(clusterId)`;
- `cancelRun(runId)`;
- active run ID and workflow-session identity;
- synchronous editor execution lock;
- prepare/save/request lifecycle;
- status polling or existing run-history observation;
- reconciliation of run results into the execution store without changing canonical document data.

Coordinator rules:

1. Resolve only canonical cluster IDs from current document state; never use a display ID as execution scope.
2. Disable execution in history/read-only mode and while cluster metadata is invalid.
3. Block structural/configuration edits during the initial active run; allow pan, zoom, expand/collapse, and movement because positions are non-executable. Document standalone-root `input_data` semantics and collect only validated boundary/reference inputs; never infer missing server context from stale member UI output.
4. Ignore stale messages from old run IDs or workflow sessions.
5. Detach observation on navigation without cancelling backend work; reattach to an active run on reload/return.
6. Stop only the active run. Do not deactivate schedules, streaming runners, backtests, or unrelated workflow jobs.
7. Reconcile node results by canonical node ID, preserving positions/configuration and exposing pinned/skipped/blocked states distinctly.

Exit: the run survives view toggles, hidden members, navigation, and reload without duplicate submission.

## Phase 8 — Add the shared compact/expanded execution footer

Create one `ClusterExecutionControl` driven by coordinator state and render it:

- in a reserved footer in the compact card;
- at the bottom of the expanded frame, outside member hit areas.

States: `Execute cluster`, `Preparing…`, `Queued`, `Running`, `Stop`, `Completed / Run again`, `Failed at <node> / Run again`, and `Blocked` with a specific inspectable reason.

Interaction and layout requirements:

- Use the existing design-system `Button` with play/stop/spinner icons and semantic cluster tokens.
- Accessible name: `Execute cluster <title>`; expose textual status in a restrained live region.
- Add `nodrag nopan`; stop pointer-down, click, double-click, Enter, and Space from triggering selection drag or expand.
- Guard card-level keyboard expansion with `event.target === event.currentTarget`, so Enter/Space on Execute cannot also expand the card.
- Mouse, touch, Enter, and Space submit exactly one run.
- Update compact height and handle positions together so footer and proxy handles never overlap.
- Give the expanded footer `pointer-events-auto`, reserve frame bottom space, and verify low/high zoom geometry.
- Both views render the same run ID/state; expanding or collapsing cannot start, stop, or duplicate execution.
- Keep the existing cluster color/drag implementation from the aligned target branch; do not reintroduce generic white styling.

## Phase 9 — Release collapse and execution safely

Use separate capability gates for:

1. cluster-scoped backend execution;
2. compact/expanded collapse;
3. migration of whole-workflow manual execution away from mounted components.

The scoped backend path makes the new button headless, but this checkout’s Execute All and single-node paths still depend on mounted listeners. Do not turn on general collapse until supported whole-workflow manual execution is moved to the shared backend coordinator or an equivalent renderer-independent path passes parity tests. Never fall back from a failed cluster request to executing the whole workflow.

Backend changes must also be copied to the separate `coreza-io/coreza-backend` repository according to the project’s repository-separation rule.

## Test and acceptance matrix

### Planner/runtime

- Chain executes each member once in dependency order, independent of stored array order.
- External predecessor/successor and another cluster never execute or receive state mutations.
- Multiple boundary edges preserve edge/handle provenance.
- If/Switch runs only selected paths and a join waits for selected branch groups plus independent inputs.
- Sequential, zero-item, batched, and distributed loops retain scope and complete once.
- Pinned `false`, `0`, `""`, `[]`, and permitted `null` skip the action and route correctly.
- Attachments are available to owners but never scheduled as roots.
- Missing/stale boundary input, unsupported context, malformed cycle, and empty executable scope fail preflight.
- Member failure blocks dependents and names the failed member; pending required members cannot produce success.

### API/security/queue

- Unauthorized workflow, tampered cluster ID/membership, stale revision, oversized snapshots, and dangerous keys are rejected.
- Cluster A, cluster B, and whole workflow never reuse the wrong cached plan.
- Same idempotency key returns the same run; a different key creates a new run.
- Queue failure marks the run failed.
- Stop before dequeue, during an action, and during distributed Loop cancels only that root run and descendants.
- Late completion cannot overwrite cancelled/failed status.
- Run history stores scope/source revision and remains readable after cluster rename/dissolve.

### Frontend/browser

- The user’s three-member cluster executes identically collapsed and expanded.
- Immediate edit → run uses the newest saved values.
- Execute via click, touch, Enter, and Space does not drag, expand, or double-submit.
- Expand/collapse and movement during a run preserve one run and current node positions.
- Save conflict, preflight failure, network uncertainty, reload, and navigation release/recover coordinator state correctly.
- Stop affects only the cluster run; scheduled/live/backtest activity remains unchanged.
- Compact and expanded footers remain readable and usable in dark/light/system themes and across zoom levels.
- Existing Execute All, single-node, history restore, drag/theme, grouping, scheduling, live, and backtest regressions pass.

## Completion gate

The feature is complete when the server—not the projected UI—derives an immutable cluster scope from an owned saved revision; every enqueue, route, Loop continuation, result, and cancellation remains inside that scope; boundary inputs and external references are explicit; run history is truthful and revision-bound; and one shared footer executes/stops the same run in compact or expanded view without relying on mounted member components.