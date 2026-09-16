# Node grouping (Clusters) — Coreza-owned end-to-end implementation plan

## Clean-room position

This plan is Coreza's own design. Nothing is copied from n8n: not source, not type or field names, not validation messages, not numeric limits, not UI copy. The attached document surveyed n8n for context; that survey is background only, and every naming and limit decision below is made independently.

- Our own domain names: `NodeCluster`, `clusters`, `memberNodeIds`, `node_clusters`.
- Our own limits: cluster note text capped at 200 characters, chosen to fit our frame header at our node sizes.
- Our own default titles: `Cluster 1`, `Cluster 2`.
- Our own error text, matching existing Coreza validation messages.
- Frame padding, card sizes and spacing come from Coreza's node card sizes and theme tokens, not from any external values.

The feature is called **Clusters** in the UI ("Group selection into a cluster").

## Review of the current code (16 Sep, this workspace)

I searched the whole repository for the feature before planning further, and **none of it is present in this project**:

- No `clusters` / `NodeCluster` / `node_clusters` anywhere in `src`, `coreza-backend/src` or `setup/database-schema.sql`.
- No cluster frame component, no validator module, no document provider.
- `src/pages/WorkflowEditor.tsx` still passes only `onNodesChange`, `onEdgesChange`, `onConnect`, `onDrop`, `onDragOver`, `onMouseMove`, `onNodeDoubleClick`, `onPaneClick` to `ReactFlow` — there is no `onSelectionContextMenu`, `onNodeContextMenu` or `onPaneContextMenu`, which is exactly why right-click still shows the browser's own menu.
- Keyboard handling at `src/pages/WorkflowEditor.tsx:1290` covers undo, copy, paste and delete, but has no grouping shortcut, and undo is still pop-only with no redo.
- Recent commits are plan updates plus the Compute nth-root merge; no grouping commit landed here.

So the work was either done on a branch or repository that this workspace does not see, or it did not save. Before re-implementing, confirm which branch holds it. The plan below stands as written, with the context menu now specified explicitly.

## Canvas context menu (right-click)

Right-click currently falls through to the browser menu. Add a Coreza canvas menu, worded in our own terms, in `src/pages/WorkflowEditor.tsx`:

- Wire `onSelectionContextMenu`, `onNodeContextMenu` and `onPaneContextMenu`; each calls `event.preventDefault()` and opens our menu at the pointer position. Use the existing `src/components/ui/context-menu.tsx` primitives with a controlled open state anchored to the flow position, so styling matches the app.
- Selection menu items, disabled with a reason when unavailable: **Group nodes into a cluster** (`Ctrl/Cmd+G`), **Dissolve cluster** (`Ctrl/Cmd+Shift+G`, only when the selection is exactly one cluster), **Copy**, **Duplicate**, **Delete nodes**. Counts appear in the label the way our other bulk actions read.
- Node menu: the same entries scoped to that node, plus **Rename** and **Open**.
- Pane menu: **Select all**, **Clear selection**, **Paste**, **Add node**.
- Close on Escape, pane click, scroll and zoom; never open while a connection drag is in progress or on a read-only canvas.
- The grouping entries call the same validated command-boundary mutations as the shortcuts — no separate code path — and show the validator's reason code when the selection cannot become a cluster.
- Add the `Ctrl/Cmd+G` and `Ctrl/Cmd+Shift+G` branches to the existing keydown effect, honouring its current editable-target guard.
- Tests: menu opens on right-click over selection, node and pane; the browser menu is suppressed; disabled entries carry reasons; grouping from the menu and from the shortcut produce identical documents.

## Review of the attached plan

Verified against the code, and its Coreza claims hold:

- `src/pages/WorkflowEditor.tsx` renders `ReactFlow` directly with `useReactFlow()`; `WorkflowCanvas.tsx` is not the live editor.
- `src/hooks/useWorkflowPersistence.ts` writes directly to Supabase `workflows`, serialises a node-field whitelist, and hashes only `{ name, nodes, edges }`.
- `src/hooks/useWorkflowVersioning.ts` snapshots `name, nodes, edges, is_active` in a separate read-then-insert before the save.
- `src/utils/workflowExecutor.ts` dispatches `auto-execute-node`; `src/hooks/useNodeAutoExecution.ts` binds that listener to the node component lifecycle, so hiding a node removes the only thing able to execute it.
- Rename changes the node id and rewrites edges, so membership must be remapped in the same operation.

Its central principle — clusters are editor metadata with a separate canvas projection, never an executable unit — is adopted.

### Corrections and improvements

1. **Do not migrate the save path here.** Keep the current Supabase write, put validation in one isomorphic module used by editor and backend, and move the save boundary later as separate work.
2. **Execution decoupling is its own stage**; collapse ships only after it passes integration tests.
3. **Add a stage 0** for the canonical document provider and a real history cursor with redo; today's undo is pop-only.
4. **No analytics or experiment gating** — a local feature flag only.
5. **Collapse state is never saved** in the workflow document.

## Data model

```ts
interface NodeCluster {
  id: string;              // UUID, independent of the title
  title: string;           // non-empty, unique within the workflow
  memberNodeIds: string[]; // real node ids, unique
  note?: string;           // plain text, max 200 characters
}
```

Saved document becomes `{ nodes, edges, clusters }`; `clusters` in frontend and export objects, `node_clusters` in Supabase rows, mapped in one place. Missing legacy data defaults to `[]`.

Never persisted: cluster coordinates or size, projected edge ids, renderer `hidden` flags, synthetic nodes, execution summaries, collapse state. Bounds derive from member positions.

Local-only view state: expanded cluster ids, selected cluster ids, measured member sizes. Only the expansion preference goes to local storage, scoped to user and workflow.

## Edge semantics adapter

Before any rule runs, normalise every Coreza edge:

```ts
type SemanticEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  kind: 'main' | 'attachment';
};
```

`kind` comes from our node manifest and handle metadata, never from display names or React Flow edge styling. AI Agent `chatModel`, `memory` and `tool` connections are attachments that stay with their owning agent, recursing where an attachment has its own dependencies. If and Switch branch handles are main edges. Triggers and Loop routing are resolved from node definitions. Unknown node or handle semantics return an explicit "cannot cluster this selection" result for new clusters, while existing workflows still load expanded and executable.

## Cluster rules

`src/domain/clusters/validate.ts`, imported by the editor and mirrored into the backend. Three entry points share one indexed graph per transaction: selection validation, single-cluster validation, whole-document validation. Topology is recomputed only after graph, type or handle changes — never on execution status or pointer movement. Every failure returns a reason code plus the implicated node and edge ids.

1. Resolve selected ids and expand attached dependencies with a visited set. If an attachment is shared with an owner left outside, reject and name that attachment rather than silently pulling in unrelated nodes.
2. Creation needs at least two connectable members after expansion. An existing valid single-member cluster left after deletion is not forced to dissolve.
3. Reject overlapping membership, triggers as members, duplicate cluster ids or titles, duplicate or missing member ids, and empty clusters.
4. The induced graph of members must be weakly connected, counting attachment relationships.
5. Among main edges crossing the boundary, the set of distinct internal targets for incoming edges and distinct internal sources for outgoing edges must each be of size zero or one.
6. The incoming member must be an internal root and the outgoing member an internal leaf, with the connecting path checked when both exist. Boundaries are never inferred from `memberNodeIds` order, and several handles on a boundary member is not itself a failure.
7. Loop cycles are handled explicitly from our Loop routing semantics, using strongly connected components where useful: a supported closed loop may expose its Loop node as the exit. Cycles are not blanket-banned. A fixture for each accepted shape is a release gate.
8. Any attachment edge with exactly one endpoint inside is rejected.

## Command boundary

Every graph mutation runs as:

```text
current document + command
  -> candidate document
  -> normalise ids, find affected clusters
  -> validate candidate
  -> commit once, one history entry
```

Covered commands: connect, reconnect, edge delete, dynamic Switch handle changes, insert-on-edge, node replacement, rename, paste, node delete, restore. A post-render cleanup effect is not acceptable — it would let an invalid graph reach autosave or execution.

For a new boundary edge, extend membership automatically only when exactly one endpoint is unclustered: expand its required attachments, revalidate the whole candidate, and commit edge plus membership together. Otherwise reject with a message naming the cluster and the boundary problem, and offer an "Dissolve cluster and apply" action that does both in one undoable transaction.

Deletion policy: remove deleted ids from membership, drop clusters left empty, keep valid single-member clusters, and dissolve only the metadata if deletion disconnects a cluster — telling the user which cluster went. Nodes and edges are never held hostage by an organisational feature. Undo restores the whole pre-delete document.

## Stages

### Stage 0 — canonical document and history

- Add a workflow document provider with canonical node/edge reads and writes. Route `StableNodeContext`, rename, reference resolution, upstream-input lookup and traversal through it; keep `useReactFlow` for genuine canvas concerns.
- Replace pop-only undo with a command/cursor history: one entry per user operation (a whole drag included), new mutation clears redo, snapshots cover nodes, edges and clusters atomically.
- No user-visible change; this de-risks everything after it.

### Stage 1 — expanded clusters

- Mutations: create, retitle, edit note, add/remove member, dissolve — each undoable and validated through the command boundary.
- Toolbar and context-menu entry "Group nodes into a cluster" with `Ctrl/Cmd+G`, and `Ctrl/Cmd+Shift+G` to dissolve. Unavailable actions are disabled with a reason. Shortcuts are ignored while typing, in dialogs, and on read-only canvases, and the browser default is only prevented when we handle the key.
- Frame drawn behind nodes via `ViewportPortal` and `getNodesBounds`: title, note, member count, collapse control, dissolve action. The frame body never intercepts member clicks or connection gestures; the header handles dragging; handles stay reachable on expanded nodes; selection and focus have visible states.
- Bounds use canonical positions plus measured sizes, with a fallback size for unmeasured nodes and cached sizes kept across collapse, so a hidden member can never collapse the frame to zero.
- Clicking the header selects the cluster and its members as one logical selection. Copy and cut take the whole cluster. "Dissolve" removes metadata only; "Delete nodes" is a visibly distinct action that removes members and incident edges through the normal transaction.
- Movement: on drag start capture every member's canonical position and the pointer in flow coordinates; preview with one flow-space delta against that fixed baseline (no per-event rebasing, no manual zoom maths); apply the editor's snapping policy; Escape cancels; commit all positions in one transaction; a node in both a selected cluster and the selection moves exactly once.
- Clipboard: copy includes cluster metadata only when every member is copied; paste allocates node ids first, remaps edges and `memberNodeIds` with the same map, mints fresh cluster UUIDs, resolves title collisions, applies one offset in one transaction; partial copies paste as plain nodes; cut is copy plus removal in one undoable step.
- Rename remaps membership atomically and never changes the cluster UUID.

### Stage 2 — execution decoupled from renderers

Mandatory before collapse:

- Move execution registration and submission out of visual node lifecycles into controllers owned by the workflow runtime, mounted per canonical node whether or not a renderer exists. Exactly one controller per real node; no double registration during migration.
- Dispose on node or workflow removal, never on collapse; reconcile on rename and replacement.
- Keep execution output and status in runtime state keyed by real node id; status changes never dirty the document or create history.
- Rebuild executor context on canonical node/edge changes, including same-count id or endpoint changes.
- Assert synthetic cluster ids and projected edge ids can never reach execution payloads, input resolution, branch routing, reference selectors or queues.

### Stage 3 — collapse

1. One display-only compact card per collapsed cluster.
2. Member renderers and internal edges are hidden.
3. External edges route to the card's display handles, with every canonical endpoint and handle kept in a projection index.
4. Edges between two collapsed clusters project at both ends.
5. Visually identical edges may be combined but retain every original edge id. Deleting a single-edge projection deletes that real edge; deleting an aggregate requires choosing the real connection or expanding first — never a silent multi-delete.
6. Compact-card handles are not connectable in the first release; adding or rewiring requires expanding.
7. Expanding restores real nodes and edges exactly; neither transition changes canonical data.
8. Canonical positions are preserved on collapse and expansion reoccupies the original area. Fit-to-cluster and normal navigation are provided. Any neighbour displacement is a later polish step implemented as reversible view offsets — expanding must never silently save a new layout.
9. Card status precedence: error, running, waiting, success, idle, with failed and running counts and distinct warning badges; no invented execution record for the cluster.
10. Clicking a failed member in run history expands its cluster and focuses the real node. Search, error navigation and programmatic focus expand the owner. Fit-view and minimap use the rendered representation without double-counting hidden members. Keyboard focus is handled when the focused node disappears on collapse. Read-only views may expand locally without mutating the document.
11. New clusters start expanded; imported or pasted clusters start collapsed.

## Persistence, versioning, history

- Migration adds `node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb` with a JSON-array check to `workflows`, `workflow_versions` and `workflow_runs`; update `setup/database-schema.sql` and regenerate Supabase types. Backfill to `[]`; never infer historical clusters.
- `useWorkflowPersistence` serialises `node_clusters`, runs the shared validator before writing, and includes normalised clusters in the dirty hash — membership compared as a set so reordering alone creates no version.
- `useWorkflowVersioning`: snapshot `node_clusters` too, and move the snapshot-then-save pair into one Supabase RPC that checks a revision column, inserts the prior document into `workflow_versions`, writes the new document and bumps the revision. A revision conflict rejects and reloads instead of overwriting another editor's work. A failed save never advances the saved hash.
- Run creation captures `node_clusters` with its node/edge snapshot; restore-from-run uses that snapshot's clusters, never today's. The execution queue payload is unchanged.
- Export moves from `1.0` to `1.1` with an optional top-level `clusters`; the importer accepts both and defaults to `[]`. Import ids are regenerated as today, with cluster UUIDs remapped through the same id map.
- Duplicating a workflow or template copies clusters with a complete node id map and fresh cluster identities.
- Invalid clusters on a normal save are rejected with structured violations. Invalid clusters in an import load the executable graph expanded, list diagnostics, keep the original import recoverable, and exclude the bad metadata from projection rather than deleting it.
- With the feature flag off, every real node shows and saved metadata is preserved untouched — never replaced with an empty array on save.

## Tests

- Validator units: exclusive membership, triggers, connectivity, single entry and exit, multi-port boundary members, each accepted Loop shape, shared attachments, attachment edges crossing the boundary, blank and duplicate titles, note length, reason codes.
- Command boundary: connect, reconnect, edge delete, Switch handle change, insert-on-edge, replacement, rename, paste, delete, restore — each validated before commit, each one history entry.
- Deletion policy: empty cluster dropped, singleton kept, disconnection dissolves metadata only, undo restores everything.
- Clipboard: full copy, partial copy, id and membership remapping, title collisions, cut.
- Movement: no drift over many drag events, Escape cancel, overlapping selection moves each node once.
- Persistence: round-trip with clusters, legacy rows without the column, dirty-hash behaviour, RPC revision conflict, version restore, run snapshot restore, workflow duplication.
- Export and import for `1.0` and `1.1`.
- Stage 2: a node with no renderer mounted still executes, resolves inputs, reports output and completes callbacks; exactly one listener per node; synthetic ids never reach execution payloads.
- Stage 3: projection hides members and internal edges, external edges remap, aggregate-edge deletion is blocked, status precedence, expand-on-focus from run history, fit-view and minimap, keyboard focus on collapse.
- Browser checks for frame drag, membership by drop, collapse and expand.

## Verification

Run the frontend test suites plus node-schema validation, reading full output, then drive the editor in a browser: create a cluster from a selection, retitle it, drag it, undo and redo, save and reload, export and re-import, and after stage 2 collapse it and execute the workflow with members hidden.

## Backend repository note

Backend validator, routes and run-repository changes live in `coreza-io/coreza-backend` and must be copied across manually, as usual.

## Done when

Clusters can be created, titled, annotated, moved, copied, undone, saved, versioned, exported and re-imported without changing a single executed node or edge; collapse is purely visual and enabled only once hidden nodes provably execute; turning the feature off leaves every workflow behaving exactly as today; and every name, limit and message in the feature is Coreza's own.
