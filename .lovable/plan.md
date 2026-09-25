# Finish the cluster run button

## Goal

Complete the partially implemented **Execute cluster** button so it runs only the selected cluster, reports truthful status, stops safely, and works in compact and expanded views.

## Confirmed baseline

Already implemented:

- shared compact/expanded cluster execution control;
- canonical cluster ID wiring;
- save-before-run request with saved revision;
- backend-derived cluster membership and scoped execution guards;
- queued/running status polling and run-specific cancellation endpoint.

The following cluster-run correctness gaps are confirmed and remain in scope.

## Implementation

### 1. Clear the cluster-run release gate

- Correct the Docker workflow path from the nonexistent `coreza-backend-node/Dockerfile` to the actual backend build context and Dockerfile.
- Replace the invalid `readonly Array<...>` declaration in `WorkflowEntryActivation` with valid readonly-array syntax.
- Run the frontend and backend typechecks, focused tests, and backend production image build before enabling the feature for release.
- Keep compact collapse disabled until whole-workflow execution no longer depends on mounted node components; enabling collapse must not be used as a way to expose or test the run button.

### 2. Use canonical pinned outputs

- Replace the planner’s unsupported `values.pinned` / `values.pinnedValue` lookup with a shared canonical pinned-output reader matching frontend persistence: top-level `pinnedOutput`, with the supported hydrated fallback where required.
- Distinguish “no pin” from valid falsy pins. Preserve `false`, `0`, empty string, empty array, and an output envelope whose `data` is `null`.
- Normalize each pin once into the existing node-result envelope and seed it through `pinResults`, so the runtime routes the pinned result without invoking the real node executor.
- Include pin presence and value in the deterministic plan hash and persisted scope snapshot.
- Add planner/runtime tests proving a pinned action node never performs its real action and each falsy value reaches downstream nodes unchanged.

### 3. Make cluster entry activation correct

- Build entry activations from exact boundary-edge packets rather than priming every incoming edge with one merged value.
- For a cluster with no incoming boundary edge, activate every valid internal root explicitly.
- Handle the supported `Loop → Body → Loop` topology explicitly: the Loop must receive a starting activation even though its return edge makes it appear to have an internal predecessor.
- Reject a plan with no valid entry activation instead of allowing an empty queue to report success.
- Reject unsupported cycles and unsupported parallel/distributed Loop clusters during preflight until descendant completion is implemented.
- Add tests for a standalone linear cluster, multiple roots, boundary-fed entries, sequential Loop topology, and rejected parallel Loop topology.

### 4. Correct branch and join readiness

- Replace the current `group.some(...)` shortcut with activation-aware dependency tracking.
- Record the selected If/Switch handle and the concrete paths required for that activation.
- Require all independent inputs and all required paths within the selected branch before a join runs.
- Keep activation identity separate across loop iterations so payloads from different iterations cannot satisfy one another.
- Mark untaken branches as `branch_skipped` and downstream nodes that cannot become ready as `dependency_blocked`, instead of silently treating them as successful.
- Add tests for true/false branches, two required paths on one selected branch, nested conditionals, joins after loops, and untaken branches.

### 5. Supply boundary inputs and external references

- During save-before-run preparation, inspect the saved cluster’s incoming boundary edges and collect one value per canonical edge ID from current pinned/editor execution data.
- Submit those values as `boundary_inputs` with provenance; never key them by display-node IDs or labels.
- Discover expression references from cluster members that point to nodes outside the cluster, resolve only approved snapshots, and submit them as `reference_snapshots`.
- Keep external reference definitions available for name/ID resolution without adding those nodes to executable membership or execution order.
- Enforce existing snapshot size/depth/dangerous-key limits on the server and reject missing, stale, or ambiguous references before queueing.
- Show a specific blocked reason in the button when a required boundary value or external reference is unavailable.
- Add tests for incoming boundaries, multiple inputs, external references, missing values, invalid references, and attempts to execute referenced external nodes.

### 6. Emit only boundary outputs that actually routed

- Stop deriving every boundary output from the final source-node result.
- Capture a boundary output only when the exact canonical source handle routes during that activation.
- Preserve edge ID, source handle, value, and activation/iteration identity in the result.
- Do not emit values for untaken If/Switch handles or inactive Loop exits.
- Add tests proving an If result emits only the selected `true` or `false` boundary edge and loop outputs retain iteration identity.

### 7. Make Stop durable and truthful

- Persist cancellation intent for the root cluster run before scanning or cancelling queue jobs.
- Have root workers, loop children, aggregators, and continuations check that durable intent before starting, before enqueueing descendants, and before writing success.
- Cancel all queued/running descendants by `rootRunId`; do not treat a best-effort queue scan as proof that execution stopped.
- Keep the run in `cancelling` until workers acknowledge cancellation and no descendant remains eligible to start.
- Make cancellation idempotent and terminal-state guarded.
- If the cancellation request fails, retain the active run ID and editor lock, show the error, and continue status reconciliation; never clear local tracking while backend work may continue.
- Add tests for queued cancellation, active cancellation, loop descendants, late continuation prevention, repeated Stop clicks, and cancellation request failure.

### 8. Make run identity and history reliable

- Compute a normalized request fingerprint from workflow ID, saved revision, canonical cluster ID, plan hash, boundary inputs, reference snapshots, and pinned outputs.
- Store the fingerprint with the idempotency key. Reuse an existing run only when both match; reject reuse of one key with different inputs.
- Resolve an existing idempotent request before returning a revision conflict when it represents the same already-created run.
- Persist a coherent run snapshot: the complete saved workflow snapshot plus cluster scope metadata, or a self-contained scoped snapshot whose cluster metadata cannot reference omitted nodes. Do not store scoped nodes beside all workflow clusters.
- Persist member outcomes (`succeeded`, `failed`, `cancelled`, `pinned`, `branch_skipped`, `dependency_blocked`, `attachment_only`) so the button’s terminal state reflects actual cluster completion.
- Verify the deployed schema exposes the required revision, scope, idempotency/fingerprint, cancellation, and outcome fields before release.

### 9. Harden the button coordinator

- Extend the coordinator request to send collected `boundary_inputs` and `reference_snapshots`.
- Retain one idempotency key for the whole submission attempt rather than generating a new key for every retry.
- After every awaited save/request/cancel/status call, confirm the workflow session, cluster ID, and run ID are still current before updating UI state.
- Reattach to a queued/running/cancelling cluster run from persisted run history after reload or navigation.
- Derive `blocked` from current conditions instead of storing it permanently; correcting the cause must re-enable the button.
- Use one editor execution lock covering cluster runs, whole-workflow runs, direct node execution, and structural edits that would invalidate the saved revision.
- Preserve the active run and lock on transient polling failures.
- Represent cancellation as its own terminal state rather than displaying it as a generic failure.

### 10. Preserve the shared compact/expanded button

- Keep **Execute cluster** permanently visible in idle state in both the compact card footer and expanded frame footer.
- Both views must read the same canonical cluster run state and invoke the same execute/cancel actions.
- Keep `nodrag nopan`, pointer propagation guards, and the keyboard target guard so the button never drags, selects, expands, or collapses the cluster.
- Keep card/frame dimensions, footer space, and boundary handles synchronized; refresh node internals when dimensions or handle sets change.
- Switching views during Preparing, Queued, Running, or Cancelling must preserve the same run ID without resubmission.

## Verification

### Automated

- Canonical pinned values, including falsy values, bypass their executors.
- Every accepted cluster plan has at least one valid activation.
- Sequential Loop entry works; unsupported distributed Loop scope is blocked.
- Selected branches wait for every required path; untaken paths never satisfy joins.
- Incoming boundary values and external references reach only intended members.
- Only the exact routed source handle produces a boundary output.
- Idempotent retries reuse the same matching run and reject mismatched fingerprints.
- Cancellation blocks descendants and remains `cancelling` until acknowledged.
- Reload reattaches to the active run; stale async responses cannot overwrite a newer session.
- Scoped history contains no dangling cluster membership and records every member outcome.

### Browser acceptance

1. Compact and expanded clusters show the same visible **Execute cluster** button.
2. Clicking the button saves once and submits exactly one scoped run.
3. A cluster with an incoming connection executes using the captured boundary value.
4. Pinned nodes do not perform their live action.
5. Branch and sequential-loop clusters finish with accurate member states.
6. Stop remains `Cancelling…` until the run and descendants are stopped.
7. Expanding, compacting, navigating away/back, or reloading preserves the active run and status.
8. Fixing a blocked condition re-enables execution without recreating the cluster.
9. Cluster failure never starts whole-workflow execution.
10. Frontend/backend checks and the backend production image build pass.

## Completion criteria

The cluster run button is complete only when it visibly works in both cluster views, executes the saved canonical cluster with correct pins, boundaries, references, branches, and supported loops, reports durable outcomes, cancels the entire scoped run safely, survives reload/view changes, and passes the focused automated, browser, and release checks.
