# Complete Coreza cluster expand/collapse safely

## Review conclusion

The submitted repair plan is technically strong and correctly treats collapse as a canvas projection, not a workflow mutation. Its runtime, projection, interaction, Loop-validation, and browser-test concerns should be retained.

One correction is required before implementation: the reviewed GitHub revision and this checkout are not the same implementation state.

- In the reviewed revision described by the recommendation, compact projection exists behind `CLUSTER_COLLAPSE_ENABLED = false`.
- In this checkout, `capabilities.ts`, `projection.ts`, `viewState.ts`, `CompactClusterNode.tsx`, and `clusterProjection.test.ts` do not exist. `WorkflowEditor` renders only an expanded frame with title, note, count, Dissolve, and Delete controls. Therefore the missing icon here is caused by the collapse feature being absent, not merely disabled.
- This checkout already contains newer persistence work than the earlier audit reported: editor save/load uses the authenticated workflow API, updates carry `expected_revision`, backend update calls `save_workflow_document`, and manual execution checks `expected_revision` and records the workflow revision. These parts must be verified and completed, not rebuilt from assumptions.

Implementation must start by choosing the actual integration SHA and then either bringing the reviewed compact-projection commit into that branch or implementing the equivalent modules once. Do not create a second cluster system.

## Product contract

- Canonical workflow state owns real nodes, edges, configuration, positions, handles, cluster metadata, and intentionally pinned output.
- Workflow runtime owns execution controllers, requests/results, cancellation, Loop state, subscriptions, cursors, and status.
- Canvas view owns expansion, logical selection, focus, measurements, drag preview, and projected cards/edges.
- Expanding or collapsing changes only canvas view. It must not change persisted content, dirty state, undo history, executable topology, configuration, pinning, listeners, or execution count.
- Keep Coreza terminology and behavior. Do not copy external identifiers, wording, source, or algorithms.

## Phase 0 — Align the source and establish gates

1. Record the frontend and backend branch/SHA used by the preview and intended release.
2. Compare the target branch with the reviewed compact implementation before coding. Reuse compatible Coreza modules; do not duplicate them under new names.
3. Verify the deployed schema and RPC contract for `node_clusters`, workflow `revision`, run `source_workflow_revision`, and `save_workflow_document`.
4. Establish the real frontend/backend test commands and baseline failures.
5. Add deterministic fixtures for:
   - the user's three-node cluster;
   - Loop + loop body + a node on the done path;
   - two connected clusters;
   - branching and multiple boundary handles;
   - pinned output, in-flight execution, and equal-count rewiring;
   - a real node ID colliding with the reserved compact-display prefix.

Exit: the implementation target is unambiguous and schema/API prerequisites are verified.

## Phase 1 — Finish canonical document commands

Expand the existing `WorkflowDocument` command boundary so React Flow setters are never authoritative document mutations once projection is enabled.

Commands must cover deletion, dissolve, rename, duplicate, copy/cut/paste with ID remapping, node and cluster movement, edge create/remove/reconnect/replace, cluster creation/metadata edits, import, and version restore.

Each command must:

- receive canonical nodes, edges, and clusters;
- validate and return one immutable candidate;
- update membership and connected edges atomically;
- create exactly one undo entry;
- preserve current runtime data when applying position-only changes.

Replace the current full-document cluster-drag baseline with a position-only baseline applied to the latest document. Escape/pointer cancellation restores positions only, so outputs or configuration changed during the drag are not overwritten.

Acceptance: delete a hidden member, undo once, and restore its node, exact edges/handles, position, membership, and display projection.

## Phase 2 — Remove runtime ownership from node renderers

The current execution path dispatches `auto-execute-node`; `useNodeAutoExecution` registers the listener in the mounted node and polls React Flow for output. `useNodeExecution` also reads `getNodes()`/`getEdges()`, aborts polling on unmount, and writes through rendered node state. This prevents safe hiding of members.

1. Add workflow-owned runtime controllers keyed by canonical node ID.
2. Extract payload preparation, reference resolution, credentials, submission, response/error normalization, Loop operations, cancellation, polling/subscriptions, and callback settlement from renderer hooks.
3. Make runtime execution return a promise/result directly; stop inferring completion by polling a rendered node.
4. Migrate all semantic graph reads to the canonical document provider. React Flow graph reads remain visual-only.
5. Move schema/default reconciliation to document load/import/configuration commands. Commit field edits synchronously to canonical state or explicitly flush them before hiding a renderer.
6. Reconcile pinned output from canonical content/runtime. Renderer unmount must not unpin or unregister execution ownership.
7. Define exact cleanup for delete, rename, workflow switch, Stop, and session disposal; late responses cannot update another session.
8. Use an immutable canonical run snapshot so equal-count rewires/configuration edits are used by the next run without recreating executors for view-only changes.

Hard gate:

- a real node that never rendered resolves references and executes;
- collapse during a request or stream does not cancel it;
- 100 toggles do not change listener/controller counts or duplicate submissions;
- pinned output and committed fields remain authoritative;
- delete/rename/Stop disposes the correct resources exactly once.

Until this gate passes, any collapse control must remain behind a disabled, observable capability guard.

## Phase 3 — Build or correct the display projection

Create one pure projection from canonical nodes/edges/clusters plus local expansion state.

- Expanded: show real members, real internal/boundary edges, and the frame.
- Compact: omit member visuals/internal display edges and add one non-executable compact cluster card.
- Keep unclustered real nodes unchanged.
- Project each real boundary edge separately and preserve canonical edge ID, endpoint IDs, and handles in an explicit mapping.
- Project both endpoints between two compact clusters.
- Allocate all collision-safe compact display IDs first, then project edges through that final map. Never compute edge endpoints from an unsuffixed provisional ID.
- Keep compact handles non-connectable in the first release; refresh node internals when boundary handles change.
- Derive error/running/listening/pinned summaries from the authoritative runtime store with defined precedence and run-reset behavior, not incidental `node.data.status` fields.
- Use one bounds/anchor calculation for frame and card; cache dimensions independently of renderer mounts.
- Assert no compact ID or projected edge enters serialization, execution, references, clipboard payloads, versions, backtests, or run snapshots.

## Phase 4 — Complete view state and interaction routing

Maintain local/pref-backed state outside `NodeCluster`:

```text
clusterViewState[clusterId] = { expanded }
```

- New clusters open expanded for naming; loaded clusters use scoped user/workflow preference, otherwise the agreed compact default.
- Expansion does not affect dirty state, save/export, versions, runs, or undo history.
- Clean stale state after delete/dissolve/restore/import.
- Represent selected real nodes and selected clusters explicitly.
- Resolve a compact card once to canonical member IDs; menu and keyboard actions call the same commands with those explicit targets.
- Remove synthetic keyboard-event dispatch for Copy/Paste.
- Compact dragging, if enabled, invokes the position-only cluster move command; otherwise mark compact cards non-draggable for the first release.
- Block or explicitly cancel a connection gesture before changing representation.
- Searching/focusing a hidden member expands its cluster, waits for mount/measurement, then centers and focuses the real node.
- Transfer keyboard focus to the paired toggle when a representation swap unmounts the clicked control.

## Phase 5 — Implement the visible Coreza expand/collapse controls

Extract the active editor's expanded overlay into a dedicated frame component; do not update an unused canvas component.

1. Render frame geometry in React Flow's viewport coordinate system, preferably with `ViewportPortal`, so bounds and controls scale consistently.
2. Use a two-row header: title and right-aligned actions on row one, optional note on row two.
3. Put destructive actions in a menu so the title cannot truncate at low zoom.
4. Add the missing icon-only control in the upper-right:
   - expanded frame: upward chevron, “Collapse cluster …”;
   - compact card: downward chevron, “Expand cluster …”.
5. Support compact-card double-click and Enter/Space on either toggle.
6. Add valid `aria-expanded`/controlled-region semantics, tooltips, focus restoration, pointer propagation guards, and reduced-motion behavior.
7. Preserve title/note drafts: Enter/blur commits one command; Escape cancels. Flush committed edits before collapse.
8. Keep the body transparent to member-node interaction and prevent toggle/menu actions from starting frame drag or canvas pan.

Acceptance: at zoom 0.5, 1, and 2, the title, note, toggle, and menu remain visible and usable; repeated toggles restore exact positions and viewport.

## Phase 6 — Extend Loop topology validation narrowly

Update frontend and backend validators together using shared fixtures.

- Recognize supported Loop feedback edges from known handles and reachability.
- Build a validation-only structural graph that excludes recognized feedback edges; never change the canonical execution graph.
- Allow external entry at the Loop and exit through an internal node on the done path, as in the supplied reference.
- Validate loop-body containment and return paths separately.
- Continue rejecting escaping bodies, malformed feedback, arbitrary cycles, invalid attachments, overlaps, triggers, unknown handles, and disconnected membership with stable reason codes.

Exit: both validators accept the screenshot-like Loop fixture and reject every malformed counterpart consistently.

## Phase 7 — Verify persistence and revision contracts already present

Do not reimplement working pieces blindly. Verify and close gaps in the current API/RPC path:

- all content saves/loads use the authenticated API and `req.user.id`;
- old browser-role writes cannot modify workflow content directly;
- update validates one immutable candidate at revision R and the RPC commits only if the locked row is still R;
- prior version + workflow update + revision increment are atomic, while no-op saves create no version;
- create returns authoritative ID/revision and the editor switches route/session/baseline before another save or run;
- in-flight edits remain dirty after save acknowledgment;
- conflict preserves the local draft and returns 409;
- manual execution/backtest uses the requested revision and records matching `source_workflow_revision`, nodes, edges, and clusters;
- scheduler, streaming, webhook, and recovery snapshots receive canonical content from one read;
- tab-hide remains best-effort with recoverable local draft behavior.

Add a two-session save/execute race test and a regression proving an old direct-write client cannot overwrite workflow content.

## Phase 8 — Enable and release

Enable the collapse capability only after Phases 1–7 pass. Keep rollback able to force expanded presentation without changing cluster metadata or canonical graph data.

Run focused unit/integration/browser coverage for:

- 100 toggles with unchanged serialized hash, IDs, edges, handles, positions, and execution counts;
- never-rendered and in-flight member execution;
- references from visible nodes to compact members;
- pinned output, field edit immediately before collapse, and equal-count rewiring;
- compact-to-compact edges, ID collision, dynamic handles, and runtime error summary;
- click/shift-click/right-click selection and matching keyboard/menu targets;
- copy/cut/paste, Delete, Dissolve, movement/cancel, and undo/redo;
- zoom/pan/fit-view, connection drag, pointer cancellation, keyboard accessibility, and focus restoration;
- preference scoping without dirtying the workflow;
- Loop accepted/rejected parity;
- save/reload/export/version restore and revision-bound manual/backtest/scheduled execution.

Browser acceptance must use the active `WorkflowEditor`: create a cluster from the Coreza context menu, collapse it with the upper-right icon, verify one compact card and correctly projected connections, execute while compact, save/reload, expand, and verify the exact canonical graph returns.

## Completion gate

The feature is complete only when the missing icon is visible in the verified release build and collapse is proven presentation-only: hidden nodes still execute, commands target canonical IDs, projection cannot leak into persistence, Loop validation agrees across frontend/backend, and reload/version/run snapshots preserve one revision-matched workflow document.