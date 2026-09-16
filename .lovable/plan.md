# Node grouping — Coreza-owned end-to-end implementation plan

## Clean-room position

This plan is Coreza's own design. Nothing is copied from n8n: not source, not type or field names, not validation messages, not numeric limits, not UI copy. The attached document surveyed n8n for context; that survey is treated as background only, and every naming or limit decision below is made independently on Coreza's own terms. Concepts like "a named frame around nodes" are ordinary editor features, not borrowed implementation.

Concretely:

- Our own domain names are used throughout (`NodeCluster`, `clusters`, `memberNodeIds`, `node_clusters`), not any external project's field names.
- Our own limits: cluster note text is capped at 200 characters because that is what the frame header can show at our node sizes — no external number is adopted.
- Our own default names: `Cluster 1`, `Cluster 2`, matching how Coreza already names repeated things.
- Our own error text, written to match existing Coreza validation messages.
- No external package, snippet, or algorithm is lifted; the topology rules below are derived from Coreza's own edge and handle semantics.

Throughout the UI the feature is called **Clusters** ("Group selection into a cluster"), so it reads as a Coreza feature rather than an imitation.

## Review of the attached plan

I verified its Coreza claims against the code, and they hold:

- `src/pages/WorkflowEditor.tsx` renders `ReactFlow` directly and uses `useReactFlow()`; `WorkflowCanvas.tsx` is not the live editor.
- `src/hooks/useWorkflowPersistence.ts` writes straight to Supabase `workflows`, serialises a whitelist of node fields, and hashes only `{ name, nodes, edges }`.
- `src/hooks/useWorkflowVersioning.ts` snapshots `name, nodes, edges, is_active` in a separate read-then-insert before the save, not one transaction.
- `src/utils/workflowExecutor.ts` dispatches `auto-execute-node` window events and `src/hooks/useNodeAutoExecution.ts` registers the listener with the node component's lifecycle — so hiding a node today removes the only thing able to execute it.
- Rename changes the node id and rewrites edges, so membership must be remapped in the same operation.

Its central principle — clusters are editor metadata with a separate canvas projection, never an executable unit — is right and is adopted.

### Corrections and improvements

1. **Do not migrate the save path as part of this work.** Switching the editor from direct Supabase writes to the backend CRUD route risks dropping fields the editor saves today. Keep the current save path, put validation in one isomorphic module used by editor and backend, and move the save boundary later as separate work.
2. **Execution decoupling is its own stage**, not a prerequisite bullet; collapse ships only after it passes integration tests.
3. **Add a stage 0.** A canonical document provider and a real history cursor with redo must exist first; today's undo is pop-only with no independent redo.
4. **No analytics or experiment gating.** A local feature flag only.
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

The saved document becomes `{ nodes, edges, clusters }`; `clusters` in frontend and export objects, `node_clusters` in Supabase rows, mapped in one place. Missing legacy data defaults to `[]`.

Never persisted: cluster coordinates or size, projected edge ids, renderer `hidden` flags, synthetic nodes, execution summaries, collapse state. Bounds are derived from member positions.

Local-only view state: expanded cluster ids, selected cluster ids, measured member sizes. Only the expansion preference goes to local storage, scoped to user and workflow.

## Cluster rules (one shared module)

`src/domain/clusters/validate.ts`, imported by the editor and mirrored into the backend:

- A node belongs to at most one cluster; every member id exists; titles unique and non-blank; no empty clusters on save.
- Triggers cannot be members.
- Members must form one connected section.
- Main connections may enter through at most one member and leave through at most one member; that boundary member may have several ports. Entry must reach an internal root, exit must leave an internal leaf, and a closed loop may exit through its Loop node.
- Non-main Coreza connections must not cross the boundary. This uses a Coreza handle adapter written against our own semantics — `chatModel`, `memory`, `tool` on AI Agent and `in`, `done`, `loop` on Loop.
- Branching inside a cluster is allowed; a cluster need not be a linear chain.

Every proposed edit (connect, disconnect, delete, replace, paste) validates a candidate graph before commit and reports a Coreza-worded reason when rejected.

## Stages

### Stage 0 — canonical document and history

- Add a workflow document provider exposing canonical node/edge reads and writes. Route `StableNodeContext`, rename, reference resolution, upstream-input lookup and traversal through it; leave `useReactFlow` for genuine canvas concerns.
- Replace pop-only undo with a command/cursor history: one entry per user operation (a whole drag included), new mutation clears redo, snapshots cover nodes, edges and clusters atomically.
- No user-visible change; this de-risks everything after it.

### Stage 1 — expanded clusters

- Document mutations: create, retitle, edit note, add/remove member, dissolve — each undoable and validated.
- Creation from a selection: expand the selection to attached sub-nodes first, require at least two connectable members afterwards.
- Frame rendering with React Flow `ViewportPortal` and `getNodesBounds`, drawn behind nodes: title, note, member count, selection state. Dragging the frame moves members together; dropping a node in or out updates membership through the guarded mutation.
- Clipboard: copy includes cluster metadata only when every member is copied; paste allocates node ids first, remaps edges and `memberNodeIds` with the same map, mints fresh cluster UUIDs, resolves title collisions (`Cluster 1`, `Cluster 2`), applies one offset in one transaction; partial copies paste as plain nodes; cut is copy plus removal in one undoable step.
- Rename remaps membership atomically and never changes the cluster UUID.

### Stage 2 — execution decoupled from renderers

Mandatory before collapse:

- Move execution registration and submission out of visual node lifecycles into controllers owned by the workflow runtime, mounted per canonical node whether or not a renderer exists. Exactly one controller per real node; no double registration during migration.
- Dispose on node or workflow removal, never on collapse; reconcile on rename and replacement.
- Keep execution output and status in runtime state keyed by real node id; status changes never dirty the document or create history.
- Rebuild executor context on canonical node/edge changes, including same-count id or endpoint changes.
- Assert synthetic cluster ids and projected edge ids can never reach execution payloads, input resolution, branch routing, reference selectors or queues.

### Stage 3 — collapse

- Canvas projection only: hide members and internal edges, render a compact card, remap external edges to it while retaining their real endpoints (one projected edge may stand for several).
- Card status precedence: error, running, waiting, success, idle, with failed and running counts, and no invented execution record for the cluster.
- Clicking a failed member in run history expands its cluster and focuses the real node. Search, error navigation and programmatic focus expand the owner. Fit-view and minimap use the rendered representation.
- New clusters start expanded; imported or pasted clusters start collapsed. Read-only views may force expansion without writing the preference.

## Persistence, versioning, history

- Migration adds `node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb` with a JSON-array check to `workflows`, `workflow_versions` and `workflow_runs`; update `setup/database-schema.sql` and regenerate Supabase types. Backfill to `[]`; never infer historical clusters.
- `useWorkflowPersistence` serialises `node_clusters` alongside nodes and edges, runs the shared validator before writing, and includes normalised clusters in the dirty hash — comparing membership as a set so reordering alone does not create a version.
- `useWorkflowVersioning`: snapshot `node_clusters` with the rest, and move the snapshot-then-save pair into one Supabase RPC that checks a revision column, inserts the prior document into `workflow_versions`, writes the new document and bumps the revision. A revision conflict rejects and reloads rather than overwriting another editor's changes.
- Run creation captures `node_clusters` with its node/edge snapshot; restore-from-run uses that snapshot's clusters, never today's. The execution queue payload is unchanged.
- Export moves from `1.0` to `1.1` with an optional top-level `clusters`; the importer accepts both and defaults to `[]`. Import ids are regenerated as today, with cluster UUIDs remapped through the same id map.
- Invalid clusters on a normal save are rejected with structured violations. Invalid clusters in an import load the executable graph expanded, list diagnostics, keep the original import recoverable, and exclude the bad metadata from projection rather than deleting it.
- With the feature flag off, every real node shows and saved metadata is preserved untouched.

## Tests

- Validator units: exclusive membership, triggers, connectivity, single entry and exit, multi-port boundary members, the Loop closed-loop case, AI sub-node handles crossing the boundary, blank and duplicate titles, note length.
- Document mutations: create, retitle, note limit, add/remove member, dissolve — each with undo and redo.
- Clipboard: full copy, partial copy, paste id and membership remapping, title collisions, cut.
- Rename and replacement remap membership atomically.
- Persistence: round-trip with clusters, legacy rows without the column, dirty-hash behaviour, RPC revision conflict, version restore, run snapshot restore.
- Export and import for `1.0` and `1.1`.
- Stage 2: a node with no renderer mounted still executes, resolves inputs, reports output and completes callbacks; exactly one listener per node; synthetic ids never reach execution payloads.
- Stage 3: projection hides members and internal edges, external edges remap, card status precedence, expand-on-focus from run history, fit-view and minimap.
- Browser checks for frame drag, membership by drop, collapse and expand.

## Verification

Run the frontend test suites plus node-schema validation, reading full output, then drive the editor in a browser: create a cluster from a selection, retitle it, drag it, undo and redo, save and reload, export and re-import, and after stage 2 collapse it and execute the workflow with members hidden.

## Backend repository note

Backend validator, routes and run-repository changes live in `coreza-io/coreza-backend` and must be copied across manually, as usual.

## Done when

Clusters can be created, titled, annotated, moved, copied, undone, saved, versioned, exported and re-imported without changing a single executed node or edge; collapse is purely visual and enabled only once hidden nodes provably execute; turning the feature off leaves every workflow behaving exactly as today; and every name, limit and message in the feature is Coreza's own.
