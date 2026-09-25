# Add the cluster run button

## Goal

Add a visible, working **Execute cluster** control to both the compact cluster card and the expanded cluster frame. Both controls must operate the same canonical cluster run and show the same status.

## Confirmed current state

- `CompactClusterNode` has title, note, member count, status, and expand controls, but no run control.
- Projected cluster data exposes expansion data/actions, but no cluster execution action or scoped run state.
- The expanded cluster frame has no execution footer.
- The backend already accepts cluster-scoped manual execution requests and returns a run ID.
- The compact card is currently `280 × 132`, so it has no reserved footer space for a run control.

## Implementation

### 1. Define the cluster run UI state

Create a small cluster-run view model keyed by the canonical cluster ID:

- `idle`
- `preparing`
- `queued`
- `running`
- `cancelling`
- `succeeded`
- `failed`
- `cancelled`
- `blocked`

Store the active `runId`, status, and user-facing failure reason with that state. Do not use the synthetic compact display-node ID as the cluster identity.

### 2. Add one cluster execution coordinator

Add an editor-level `executeCluster(clusterId)` action that:

1. Rejects duplicate clicks while the cluster is preparing, queued, running, or cancelling.
2. Completes any pending editor field commit.
3. Saves the current workflow through the existing revision-aware persistence path.
4. Uses the saved workflow revision in the request.
5. Creates one idempotency key for the attempt and reuses it if the request is retried.
6. Sends the existing cluster scope request:

```text
scope: { kind: "cluster", clusterId }
expected_revision: <saved revision>
idempotency_key: <attempt key>
```

7. Stores the returned run ID against the canonical cluster ID.
8. Observes that run through the existing execution-history/status mechanism.
9. Maps server status and preflight errors into the cluster-run view model.
10. Never falls back to executing the whole workflow when cluster execution fails.

Add `cancelClusterRun(clusterId)` that uses the active run ID and existing cancellation endpoint. Keep the control in `cancelling` until the server reports a terminal state.

### 3. Extend projected cluster data

Extend the compact cluster data contract with:

- canonical `clusterId`;
- cluster run state;
- stable `onExecute(clusterId)` callback;
- stable `onCancel(clusterId, runId)` callback.

Pass these values from the editor into cluster projection. These callbacks and transient run fields must never be persisted in `node_clusters`.

Use the scoped run as the authority for the compact cluster status. Do not infer cluster execution state solely from mounted member-node components.

### 4. Build a shared `ClusterExecutionControl`

Create one reusable control for compact and expanded views.

Display behavior:

- **Idle:** play icon + `Execute cluster`
- **Preparing:** spinner + `Preparing…`
- **Queued:** spinner + `Queued`
- **Running:** stop icon + `Stop`
- **Cancelling:** spinner + `Cancelling…`
- **Succeeded:** check status + `Run again`
- **Failed:** error status + `Run again`
- **Cancelled:** `Run again`
- **Blocked:** disabled control with a specific reason available in a tooltip or adjacent status

Interaction rules:

- Use the existing design-system `Button`.
- Keep the idle play control visible; do not make it hover-only.
- Apply `nodrag nopan` so clicking does not drag or pan the canvas.
- Stop pointer and click propagation so the control does not expand, collapse, select, or move the cluster.
- Give the control an accessible name containing the cluster title.
- Prevent the cluster card’s Enter/Space expand handler from firing when the event originated inside the control.
- Respect the editor’s existing run lock so cluster execution cannot overlap an incompatible run.

### 5. Add the control to the compact cluster card

Update `CompactClusterNode` to render the shared control in a dedicated bottom footer.

- Increase the card height while retaining its width and existing visual style.
- Keep title/note and member count above the footer.
- Recalculate incoming/outgoing handle positions for the new height.
- Include dimensions and handle IDs in the `useUpdateNodeInternals` refresh conditions.
- Ensure long titles, notes, and status text do not overlap or clip the footer.
- Preserve double-click and chevron expansion behavior outside the control.

### 6. Add the same control to the expanded cluster frame

Render `ClusterExecutionControl` in a bottom footer inside the expanded frame.

- Increase the frame’s bottom space so member nodes cannot overlap the footer.
- Keep the footer outside member-node hit areas.
- Ensure the frame overlay allows pointer interaction on the control.
- Use the same canonical cluster state and callbacks as the compact card.
- Switching between compact and expanded views during a run must show the same run ID and current status without resubmission.

### 7. Handle errors clearly

Map cluster-run failures to concise messages:

- revision conflict;
- cluster no longer exists;
- missing boundary input;
- invalid cluster configuration;
- unsupported cluster contents;
- queue or network failure;
- cancellation failure.

A failed preparation or request must return the control to a retryable state. It must not leave the editor permanently locked.

## Verification

### Automated tests

- Projection carries canonical cluster ID, run state, and callbacks without persisting them.
- Execute calls the cluster endpoint once with the saved revision, canonical cluster ID, and idempotency key.
- Repeated clicks while busy do not submit duplicate runs.
- Compact and expanded controls display identical state for one run ID.
- Stop calls cancellation for the active cluster run.
- Failure and cancellation release the editor run lock.
- Cluster execution failure never invokes whole-workflow execution.
- Card keyboard expansion ignores events originating from the execution control.

### Browser acceptance

1. A compact cluster visibly shows the play icon and **Execute cluster** at the bottom without hover.
2. Clicking it does not drag, select, expand, or collapse the cluster.
3. The control progresses through Preparing, Queued, Running, and a terminal state.
4. During a run, expanding or compacting the cluster preserves the same status and run ID.
5. The expanded frame shows the same control in its footer.
6. Clicking Stop cancels only that run and reaches `cancelled`.
7. Reloading while the run is active restores its status from persisted run data.
8. Failure shows a useful reason and permits retry.
9. Long cluster titles and multiple boundary handles remain aligned at desktop and narrow viewport sizes.

## Completion criteria

The work is complete when the run control is visibly present and functional in both cluster views, submits exactly one cluster-scoped run from the saved workflow revision, tracks and cancels that run, survives view changes and reloads, and passes the focused automated and browser checks above.
