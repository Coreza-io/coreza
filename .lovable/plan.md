# Complete Coreza node clusters, including node-style expand and collapse

## Review result

The current checkout contains a **cluster data foundation**, but not an end-to-end canvas feature.

Confirmed working foundations:

- `NodeCluster` metadata, parsing, normalization, and topology validation exist.
- Workflow save/load, version snapshots, export/import, and execution snapshot types include `node_clusters` in several paths.
- The editor stores `clusters` and includes them in dirty checks and saves.
- Focused domain tests cover basic topology, triggers, attachment expansion, shared attachments, and malformed persisted entries.

Confirmed missing or incorrect behavior:

- The live canvas is the `ReactFlow` rendered directly by `src/pages/WorkflowEditor.tsx`; it has no cluster renderer or context-menu callbacks. `WorkflowCanvas.tsx` is not the active editor path and must not be treated as the integration point.
- There is no create/dissolve command, cluster frame, compact cluster card, cluster expand/collapse state, or grouping keyboard shortcut in the live editor.
- The native browser menu appears because the live canvas does not handle selection/node/pane context-menu events.
- The existing node interaction is local view state: `NodeWrapper` starts collapsed, opens on double-click, and closes from an icon button without modifying executable node data. Clusters need the same interaction contract, adapted to a frame/card.
- Current undo snapshots restore nodes and edges only; clusters are omitted. Clipboard, cut/delete, rename, and paste are also not cluster-aware.
- `useNodeRenaming` does not remap cluster membership.
- The shared-attachment traversal is effectively bidirectional after its initial check and can absorb an owner that was not selected.
- Unknown handle IDs can fall back to `main` in `edgeSemantics.ts`.
- Load ignores `invalidIndexes`, so malformed cluster metadata is silently discarded.
- `WorkflowLifecycleService` omits `node_clusters` from its activation query but later passes that missing field into backtest run creation.
- Backend create/update schemas currently reject or strip `node_clusters`.
- `StableNodeContext` reads React Flow’s rendered nodes. Collapsing by removing/hiding member renderers would therefore alter upstream discovery and component-mounted auto-execution.

Keep the independent Coreza terms `NodeCluster`, `clusters`, `memberNodeIds`, `title`, `note`, and `node_clusters`. Do not copy external product naming, text, limits, visuals, source, or algorithms. The screenshots define only the expected compact/expanded interaction.

## 1. Establish one canonical workflow document

Introduce a single editor document boundary:

```text
WorkflowDocument
  nodes: Node[]
  edges: Edge[]
  clusters: NodeCluster[]
```

All structural operations produce a candidate document, validate it, and commit it once. Do not perform independent `setNodes`, `setEdges`, and `setClusters` updates for one user action.

Create commands for:

- create cluster from selection;
- dissolve cluster without deleting nodes;
- rename cluster and update note;
- move cluster members;
- rename node ID;
- delete/cut nodes;
- paste/duplicate;
- connect, reconnect, and delete an edge;
- replace a node or remove a dynamic handle;
- import or restore a snapshot.

Command behavior:

- Validate the complete candidate before commit.
- Record nodes, edges, and clusters in one history entry.
- Add a history cursor for undo and redo; new edits clear redo.
- Node rename remaps membership in the same transaction.
- Node deletion removes deleted IDs, removes empty clusters, keeps valid singleton clusters, and dissolves metadata only when surviving members can no longer form a valid cluster.
- Invalid edge changes are rejected without partially mutating the graph. Where appropriate, offer one atomic “Dissolve cluster and apply” action.
- Route node-card deletion through this command layer; `NodeWrapper` must not bypass it by directly mutating React Flow state.

## 2. Correct validation before exposing creation

### Attachment ownership

Represent attachment direction as owner-to-dependency semantics instead of traversing attachment edges in both directions.

- Starting from selected owner nodes, recursively include required dependencies.
- For each dependency, inspect every owner.
- Reject `shared-attachment` when any owner is outside the intended selection.
- Selecting a dependency alone must never pull all its owners into the cluster.
- Add fixtures for owner-only, owner plus dependency, dependency-only, shared dependency, and recursively shared dependencies.

### Handles

Resolve each endpoint against static and supported dynamic handles from Coreza node definitions.

- An absent handle may use a default only for node definitions that explicitly permit it.
- A supplied handle ID that cannot be resolved returns `unknown-semantics`.
- Never classify a misspelled, removed, or stale handle as `main`.
- Cover Switch branches, fallback handles, Loop handles, attachments, and ordinary main handles.

### Loop topology

Model Coreza Loop semantics explicitly using the actual `in`, `loop`, and `done` routes. Permit only closed-loop patterns that the executor supports; do not globally relax entry-root or exit-leaf checks for cycles. Pair each accepted validator fixture with an execution fixture.

### Shared validator

Use one indexed semantic graph per command and expose selection, one-cluster, and whole-document validation. Every violation retains a stable Coreza code plus affected node and edge IDs for disabled-menu explanations and recovery UI.

## 3. Add the live right-click menu and create command

Implement this in `src/pages/WorkflowEditor.tsx` or extracted components mounted by it.

### Event wiring

Add live handlers for selection, node, and pane context menus:

- suppress the browser menu only within the workflow canvas;
- preserve the current multi-selection when right-clicking one selected node;
- make an unselected right-clicked node the target selection;
- use no node target for pane right-click;
- stop propagation so one event opens only one menu;
- position from screen coordinates in a portal and clamp to the viewport;
- close on Escape, outside click, pan, zoom, navigation, or command completion;
- disable mutations in read-only mode or during connection dragging.

Inspect the installed menu primitive’s real controlled/anchor API before choosing it. Do not assume a prevented browser event can also trigger the primitive automatically.

### Commands shown

For node/selection targets:

- **Create cluster** — enabled only when current selection validation succeeds; otherwise disabled with the first specific reason.
- **Dissolve cluster** — metadata only.
- Existing implemented Copy, Duplicate, and Delete actions, all targeting the same resolved selection.

For the pane, retain only implemented actions such as Paste, Select all, Clear selection, and Add node.

Add `Ctrl/Cmd+G` for create and `Ctrl/Cmd+Shift+G` for dissolve. Preserve the existing input, textarea, and contenteditable keyboard guard. Menu and shortcut must call the same command and produce byte-equivalent metadata.

`createClusterFromSelection` must:

1. Read selected IDs from the canonical document.
2. Generate a UUID and collision-free `Cluster N` title.
3. Revalidate at invocation time.
4. Store corrected `resolvedMemberNodeIds`, including legitimate dependencies.
5. Commit once with one history entry.
6. Select the new cluster and enter title editing in its expanded frame.

## 4. Build one cluster renderer with node-style view state

Create a dedicated `NodeClusterLayer` and `NodeClusterView`. Do not model a cluster as an executable React Flow node and do not add synthetic IDs to canonical edges.

### View state contract

Keep expand/collapse separate from persisted workflow metadata:

```text
clusterViewState[clusterId] = {
  expanded: boolean,
  selected: boolean,
  editingTitle: boolean
}
```

- New clusters open expanded so the result is immediately visible and title editing can begin.
- Loaded clusters default collapsed, matching ordinary nodes’ initial compact state.
- Expand/collapse is local editor view state, not `node_clusters` data, not part of dirty checking, versions, exports, or execution snapshots.
- Remove stale view entries when a cluster is dissolved or deleted.
- Optionally persist only `expanded` as a user/workflow-scoped local preference after the base behavior is stable; never put it in the database contract.

### Match the node interaction logic

Use the same behavioral pattern as `NodeWrapper`, without copying its layout implementation:

- Compact cluster card opens on double-click.
- A clearly labeled chevron/icon button also opens it for discoverability and keyboard access.
- Expanded frame closes from the corresponding header button.
- Button clicks stop propagation and never start frame dragging.
- `Enter`/`Space` activates the focused toggle; `Escape` exits title/note editing before it collapses anything.
- Use `aria-expanded`, `aria-controls`, and tooltips “Expand cluster” / “Collapse cluster”.
- Keep stable compact and expanded dimensions during toggle animations and respect reduced motion.

### Collapsed presentation

Render one compact header card derived from member bounds:

- title, optional information indicator, member count/status summary, and expand chevron;
- one stable flow-space position based on the expanded frame’s top-left anchor;
- boundary connection previews only; no internal edges;
- no connectable synthetic handles in the first release—expanding is required before rewiring;
- selecting or dragging the compact card applies to the logical cluster, while each real member moves exactly once.

The compact card is a view projection only. It must never enter saved nodes, executor payloads, upstream lookup, node counts, clipboard node lists, or snapshots.

### Expanded presentation

Render a frame behind its real members:

- bounds come from canonical member positions plus measured dimensions and stable padding;
- a header contains editable title, optional note, member count, context actions, and collapse chevron;
- the frame body is pointer-transparent so nodes, fields, handles, and edges remain fully interactive;
- header drag moves all real members from one fixed flow-coordinate baseline, accounts for zoom exactly once, and creates one history entry on drop;
- Escape cancels a drag and restores the baseline;
- cache measured dimensions so virtualization or temporary unmounting cannot shrink bounds to zero;
- overlapping logical selections must not move a node twice.

Do not persist calculated frame bounds. Recompute them from canonical members.

## 5. Decouple collapse from runtime and canonical graph access

This is mandatory before collapsed clusters can hide/unmount real node renderers.

### Canonical graph context

Replace `StableNodeContext`’s dependence on `reactFlow.getNodes()` and `getEdges()` with stable imperative reads from the canonical workflow document. Node code must see all real nodes and edges regardless of cluster projection.

### Runtime controllers

`BaseNode` currently mounts `useNodeAutoExecution`; hiding a member can unregister behavior. Move execution/listener orchestration into workflow-level controllers:

- exactly one controller per canonical real node;
- controller lifetime follows node/workflow lifetime, not React rendering;
- expand/collapse does not create, destroy, or duplicate controllers;
- renderer components consume controller state but do not own execution registration;
- disposal occurs only when a node or workflow is removed.

Until this decoupling passes tests, collapse may visually cover/minimize members but must not set React Flow `hidden`, filter canonical nodes, or unmount them.

### Visual projection

After runtime decoupling, derive a separate render graph:

- expanded clusters render all real members and real edges;
- collapsed clusters omit member visuals and internal edges only from the render projection;
- canonical nodes/edges remain unchanged;
- projected boundary edges retain mappings to every real edge ID, endpoint, and handle;
- deleting an aggregate projection opens a choice or expands the cluster—never silently deletes several real edges;
- expand/collapse does not alter positions, workflow validity, or execution order.

## 6. Cluster editing and lifecycle actions

- Inline title editing follows node rename behavior: double-click or explicit edit action, Enter saves, Escape cancels, blur saves a valid value.
- Notes are optional, capped at the existing Coreza limit, and validated before commit.
- **Dissolve cluster** removes metadata while retaining nodes and edges.
- **Delete cluster nodes** uses a confirmation dialog and the canonical delete command.
- Frame/card context menus resolve the cluster first, then expose Expand/Collapse, Rename, Edit note, Dissolve, and Delete nodes according to mode.
- Cluster selection integrates with Delete, Copy, Cut, Duplicate, fit view, minimap, search, and execution-error focus.
- Focusing a hidden member from search/history/errors first expands its cluster, then centers and focuses the real node.

## 7. Clipboard, import, recovery, and history

### Clipboard

- Copy metadata only when all members are copied; a partial selection pastes as ordinary nodes.
- Allocate all new node IDs first, then remap edges and memberships through the same map.
- Mint new cluster UUIDs and collision-free titles.
- Commit pasted nodes, edges, and clusters once.
- Never copy compact-card or frame projection data.

### Load and import

- Parse persisted metadata, hydrate node definitions and dynamic handles, then run semantic validation.
- Preserve malformed raw entries and semantic failures in a recovery structure instead of ignoring `invalidIndexes`.
- Show exact diagnostics with repair, dissolve, or remove actions.
- Do not overwrite invalid raw metadata during an unrelated save without explicit resolution.

### History and dirty state

- Undo/redo snapshots include normalized nodes, edges, and clusters but exclude expand/collapse view state.
- Dirty hashing serializes only persisted node/edge/cluster fields, excluding selection, dimensions, callbacks, execution output, definitions, and projection state.
- A cluster drag is one history action, not one action per member or pointer move.

## 8. Complete persistence, run snapshots, and backend parity

### Frontend persistence

- Save the normalized canonical document after validation.
- Make version creation and workflow update revision-safe so a failed update cannot advance the saved baseline.
- Audit duplication, restore, export/import, templates, and execution-history restore for cluster metadata.

### Backend

- Add a strict `node_clusters` schema to create/update contracts.
- On partial update, load the owned workflow and validate the merged `{nodes, edges, node_clusters}` candidate. Omission preserves existing clusters; explicit `[]` clears them.
- Add repository mappings and response typing without editing generated Supabase frontend types manually.
- Use server-authoritative node definitions/handle rules; browser validation is user feedback, not the security boundary.
- Add `node_clusters` to the activation selector in `WorkflowLifecycleService`.
- Audit manual, backtest, scheduler, streaming, and webhook run creation so every persisted run snapshot receives exact cluster metadata while executors receive canonical nodes and edges only.
- Mirror backend changes manually into the separate `coreza-io/coreza-backend` repository per the project architecture.

### Connected database

Verify, rather than assume, that `node_clusters` exists on `workflows`, `workflow_versions`, and `workflow_runs` in the connected project. If any are absent, apply an additive migration through the database migration tool. Existing table ownership/RLS remains authoritative; columns alone require no new policies.

## 9. Verification matrix

### Domain and commands

- Attachment ownership/dependency permutations, nested dependencies, static/dynamic/unknown handles, Loop fixtures, overlap, missing members, invalid boundaries.
- Rename, delete, cut, paste, reconnect, handle removal, replacement, dissolve-and-apply, undo, and redo preserve a valid complete document.

### Context menu and creation

- Selection/node/pane right-click opens the Coreza menu and suppresses the browser menu.
- Selected-node right-click preserves multi-selection; unselected-node right-click targets that node.
- Menu stays onscreen near every viewport edge and closes through every specified path.
- Invalid creation is disabled with the correct reason.
- Menu and shortcut create identical metadata and one history entry.

### Expand/collapse interaction

- New cluster appears expanded; loaded cluster appears compact.
- Double-click and toggle button expand; header button collapses.
- Toggle controls do not drag/select accidentally and work by keyboard.
- Repeated toggling never changes canonical nodes, edges, positions, dirty state, or saved metadata.
- Expanded bounds include every member at multiple zoom levels.
- Compact dragging and expanded header dragging move each member once and undo once.
- Reduced-motion mode has no spatial animation.

### Runtime parity

- A node inside a collapsed cluster still resolves upstream data, auto-executes, emits output, receives stream events, updates execution status, and disposes once when deleted.
- Repeated toggles create no duplicate listeners or executions.
- Manual, backtest, scheduler, stream, webhook, and execution-history flows use only real node/edge IDs.
- Search and execution errors expand and focus the correct hidden node.

### Persistence and browser acceptance

- Save/reload, version restore, duplication, full/partial clipboard, import/export, malformed metadata recovery, and every run snapshot.
- Desktop browser test at minimum: create from right-click, edit title/note, collapse, expand, drag in both modes, undo/redo, save/reload, execute while collapsed, dissolve, and delete nodes.
- Run focused cluster tests, relevant frontend and backend suites, node-schema validation, and a production build before release.

## Delivery sequence

1. Canonical document commands and cluster-aware undo/redo.
2. Validator and edge-semantics corrections.
3. Right-click menu, shortcut, create command, and expanded frame.
4. Node-style compact/expanded view state and non-destructive visual toggle.
5. Canonical graph context and renderer-independent runtime controllers.
6. True collapsed render projection and boundary-edge projection.
7. Clipboard, import recovery, editing, selection, and focus integration.
8. Backend contracts, all run snapshots, revision-safe persistence, and database verification.
9. Full browser/runtime release matrix.

## Definition of done

A user can select valid nodes, right-click to create a visible Coreza cluster, edit it, collapse it into a compact card, and reopen it using the same interaction principles as ordinary nodes. Toggling is view-only; nodes continue executing identically while collapsed. Every graph mutation, history action, save, restore, import/export, backend write, and run snapshot preserves or deliberately resolves cluster metadata, with no synthetic cluster object entering the executable graph.
