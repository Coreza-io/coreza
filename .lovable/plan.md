# Complete Coreza Clusters and fix the missing right-click action

## Review verdict

The current implementation is a **partial data and persistence foundation**, not the end-to-end feature. The cluster types, parser, validator, database columns, save/load plumbing, version snapshots, export/import fields, run snapshot field, and nine domain tests exist.

The screenshot shows the browser menu because the live React Flow in `src/pages/WorkflowEditor.tsx` has no `onSelectionContextMenu`, `onNodeContextMenu`, or `onPaneContextMenu`, and no application menu is rendered. The editor also has no cluster creation command, shortcut, frame/card renderer, or cluster-aware undo/clipboard path. This is missing integration, not a styling or visibility issue.

The current code also confirms these correctness defects:

- Rename updates node and edge IDs but not `memberNodeIds`; delete/cut and edge edits can likewise leave clusters invalid and block saving.
- `WorkflowLifecycleService` reads only `id,user_id,nodes,edges,is_active,schedule_cron`, then passes absent `workflow.node_clusters` into backtest run creation.
- Backend create/update schemas do not accept `node_clusters`; the backend write path does not validate a merged `{nodes, edges, clusters}` document.
- The validator has no Loop-specific exception.
- Shared attachments can expand into an unselected owner when the attachment itself was selected.
- Unknown supplied handle IDs can fall back to `main`.
- Loading drops malformed entries by ignoring `invalidIndexes`; shape-valid but semantically invalid clusters remain invisible until save fails.

Keep the Coreza-owned names `NodeCluster`, `clusters`, `memberNodeIds`, `title`, `note`, and `node_clusters`. Do not copy n8n naming, UI text, limits, source, or implementation.

## Phase 1 — make all graph edits atomic and cluster-safe

Create one document command layer over `{nodes, edges, clusters}` and route grouping plus existing graph mutations through it:

```text
current document + command
  -> candidate nodes/edges/clusters
  -> normalize affected metadata
  -> validate the complete candidate
  -> commit once + one history entry
```

Cover create/dissolve cluster, rename, node delete, cut, paste, duplicate, connect, reconnect, edge delete, insert-on-edge, node replacement, dynamic handle removal, import and history restore.

- Rename remaps the old node id to the new id in membership in the same commit as nodes and edges.
- Delete/cut removes deleted ids, drops empty clusters, keeps valid singleton clusters, and dissolves only metadata when survivors become disconnected. Explain which cluster was dissolved; never block normal node deletion.
- Invalid edge mutations are rejected before graph state changes. Offer **Dissolve cluster and apply** as one undoable operation.
- Replace the current pop-only history with a cursor supporting undo and redo. Every snapshot includes nodes, edges and clusters; a new mutation clears redo.
- Update `StableNodeContext` to read canonical document nodes/edges rather than React Flow's projected/rendered graph. Keep React Flow reads for canvas-only concerns.

## Phase 2 — correct validation and semantic edge handling

### Attachment ownership

Traverse dependencies from owner to attachment, not indiscriminately in both directions. For every included attachment, inspect all owners whether it was selected initially or discovered recursively. Reject when an owner remains outside the intended selection; never silently add that owner.

Add cases for agent-only, agent-plus-model, model-only, shared model, and recursively discovered shared attachment selections.

### Handles

Resolve static handles and supported dynamic handles explicitly from Coreza definitions. Preserve valid absent/default handles only where Coreza permits them. A supplied handle id that cannot be resolved returns `unknown-semantics`; it must not silently become `main`. Add valid dynamic Switch and removed/misspelled handle tests.

### Loops

Model Coreza Loop routing explicitly from `in`, `loop`, and `done` semantics. Add narrowly defined accepted closed-loop shapes and use strongly connected components where needed. Do not relax root/leaf checks for arbitrary cycles. Each accepted topology must match executor behavior in a fixture.

### Validation architecture

Expose selection, single-cluster, and whole-document validators sharing one indexed semantic graph per transaction. Every failure returns a stable Coreza reason code and implicated node/edge ids. Recompute only after node, edge, type, or handle changes.

## Phase 3 — implement the right-click menu and real creation command

Work in `src/pages/WorkflowEditor.tsx`, which renders the live canvas; changing `WorkflowCanvas.tsx` alone will not affect this screen.

### Event integration

- Add `onSelectionContextMenu`, `onNodeContextMenu`, and `onPaneContextMenu` to the live `ReactFlow`.
- Suppress the browser menu only inside those canvas handlers, stopping propagation so one click cannot open two menus.
- For a selected node, preserve the full selection; for an unselected node, target that node; pane right-click targets no nodes.
- Position a portaled menu from `clientX/clientY` and clamp it to the viewport. Do not apply flow zoom/pan to screen coordinates.
- Use the existing context-menu primitives according to their actual trigger/open API; do not combine a prevented native event with a primitive that needs that same event.
- Close on Escape, outside click, pan, zoom, and editor navigation. Restore keyboard focus predictably.
- Disable graph mutations in read-only mode and while a connection drag is active.

### Menu contents

Selection/node menu:

- **Create cluster from selection** — enabled only for a currently valid selection; otherwise visible but disabled with the first specific reason.
- **Dissolve cluster** — removes metadata only.
- Existing working actions such as Copy, Duplicate, and Delete nodes, operating on the same resolved selection.

Pane menu:

- Paste, Select all, Clear selection, and Add node where those commands already exist and work. Do not add decorative menu items without implementations.

Add `Ctrl/Cmd+G` for create and `Ctrl/Cmd+Shift+G` for dissolve to the current keyboard handler, preserving its input/textarea/contenteditable guard. Prevent the browser shortcut only when the editor handles it.

### One command for menu and keyboard

Both entry points call `createClusterFromSelection`:

1. Read current canonical selected ids.
2. Mint a UUID and collision-free `Cluster N` title.
3. Run the corrected selection validator.
4. Use `resolvedMemberNodeIds` for valid required attachments.
5. Commit metadata once with one history entry.
6. Open the frame title editor.

Revalidate when invoked so a menu left open cannot act on stale graph state.

## Phase 4 — render and edit expanded clusters

A metadata row alone is not a visible feature. Add an expanded frame layer derived from canonical member positions and measured/fallback node dimensions.

- Draw frames behind nodes using the active React Flow viewport projection.
- Header owns selection and drag; frame body does not intercept node clicks, fields, handles, or connection gestures.
- Show editable title, optional note, member count, and distinct **Dissolve** and **Delete nodes** actions.
- Header drag translates every real member from one fixed flow-coordinate baseline; do not rebase per pointer event or apply zoom twice. Escape cancels; drop creates one history entry; overlapping logical selections move each real node once.
- Cache dimensions so temporarily unmounted nodes cannot collapse bounds to zero.
- Clicking a frame selects the cluster and all members as a logical selection.

Deliver this phase together with Phase 3 so choosing the menu action immediately creates something visible and editable.

## Phase 5 — complete clipboard, load, import, persistence and backend parity

### Clipboard and import

- Copy cluster metadata only when every member is copied. Partial copies paste as plain nodes.
- Allocate node ids first, remap edges and membership through one map, mint new cluster UUIDs, resolve title collisions, and commit paste once.
- Parse metadata, hydrate node definitions/handles, then run semantic validation.
- Preserve invalid raw metadata separately, display exact diagnostics, and provide repair/remove actions. Never silently discard malformed entries or overwrite them during an unrelated save.

### Dirty tracking and versions

- Hash only normalized fields that are actually persisted, excluding selection, dimensions and runtime/transient node data.
- Include clusters in every undo/redo and saved-version snapshot.
- Make version snapshot plus workflow save transactional with revision conflict detection; a failed save never advances the saved baseline.

### Run snapshots

- Add `node_clusters` to `WorkflowLifecycleService` activation selection.
- Audit manual, backtest, scheduler, streaming and webhook run-creation paths; assert each run snapshot preserves exact title, note and membership while execution receives only canonical nodes/edges.

### Backend contract

- Extend backend create/update schemas and repository mappings for `node_clusters`.
- On update, load the owned workflow, merge supplied fields, and validate the complete candidate. Omitted clusters preserve existing metadata; explicit `[]` clears it.
- Use a backend adapter over the same pure rules and persisted node definitions. The browser validator is for feedback, never the only authority for backend API writes.
- Apply equivalent changes manually to the separate `coreza-io/coreza-backend` repository.

### Database verification

The repository schema defines `node_clusters`, but the connected database state has not been verified. Confirm the migration is applied to `workflows`, `workflow_versions`, and `workflow_runs` before release. Keep existing RLS ownership policies; adding columns requires no new role system.

## Phase 6 — collapse only after execution no longer depends on rendering

Before hiding member components, move per-node execution registration from renderer lifecycle into workflow-runtime controllers, exactly one controller per canonical node. Controllers survive collapse and dispose only when a node/workflow is removed.

Then add display-only collapsed cards and projected edges:

- Hidden members and internal edges remain canonical and executable.
- External projected edges retain every real endpoint, handle and edge id.
- Aggregate projected edges cannot silently delete several real connections.
- Compact-card handles are non-connectable initially; expand to wire nodes.
- Expand/collapse never changes canonical positions or saved workflow data.
- Search, history/error focus, fit view and minimap use the visual projection correctly.
- Collapse preference is local view state, scoped by user and workflow, never saved in `node_clusters`.

## Test and release gates

1. **Validator:** shared attachment permutations, recursive attachments, unknown/static/default/dynamic handles, accepted Loop patterns, invalid cycles, boundary root/leaf rules, reason ids.
2. **Commands:** rename, delete, cut, reconnect, handle removal, replacement and dissolve-and-apply stay saveable; undo/redo restores the complete document.
3. **Context menu:** selection/node/pane right-click opens the Coreza menu, browser menu is suppressed, selected-node right-click preserves selection, edge positioning remains onscreen, invalid grouping shows a reason, readonly and connection drag cannot mutate.
4. **Creation/UI:** menu and shortcut create byte-equivalent cluster metadata and one history entry; frame appears immediately; title, note, drag and dissolve survive save/reload.
5. **Clipboard/import:** full and partial cluster copy, id/title remapping, malformed and dangling metadata recovery.
6. **Persistence:** legacy rows, normalized dirty hash, transactional save/version conflict, workflow duplication, every run entry point.
7. **Runtime/collapse:** a real node with no renderer still executes, resolves inputs, emits output and completes callbacks; synthetic ids never enter execution payloads.
8. Run targeted Jest suites, the full relevant frontend/backend suites, and node-schema validation. Then browser-test create, disable reason, frame drag, undo/redo, save/reload, import/export, run snapshot, collapse, hidden-member execution and error focus.

## Delivery order

1. Atomic commands and cluster-aware history.
2. Validator defects and regression tests.
3. Context menu, shortcut, create command and expanded frame as one usable milestone.
4. Clipboard and load/import recovery.
5. Backtest selector, all run snapshots, backend CRUD validation, database verification.
6. Runtime controllers, then collapse projection.

## Done when

Right-clicking a valid selected set shows Coreza's menu and creates a visible, editable cluster; every graph mutation preserves or deliberately dissolves valid metadata; all persistence and run paths retain clusters; invalid metadata is recoverable; and collapsed members execute identically to expanded members. No n8n names, copy, limits, or implementation are used.
