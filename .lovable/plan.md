# Node grouping — reviewed end-to-end implementation plan

## Review of the attached plan

I checked the attachment's Coreza claims against the code. They hold:

- `src/pages/WorkflowEditor.tsx` renders `ReactFlow` directly and uses `useReactFlow()`; `WorkflowCanvas.tsx` is not the live editor.
- `src/hooks/useWorkflowPersistence.ts` writes straight to Supabase `workflows`, serialises a whitelist of node fields, and computes its dirty hash from `{ name, nodes, edges }` only.
- `src/hooks/useWorkflowVersioning.ts` snapshots `name, nodes, edges, is_active` in a separate read-then-insert before the save — not one transaction.
- `src/utils/workflowExecutor.ts` dispatches `auto-execute-node` window events and `src/hooks/useNodeAutoExecution.ts` registers/removes the listener with the node component's lifecycle. So hiding a node today removes the only thing that can execute it.
- Node rename changes the node id and rewrites edges, so group membership must be remapped in the same operation.

The core design — groups as workflow metadata with a separate canvas projection, never an executable unit — is right, and I'm adopting it.

### Corrections and improvements

1. **Do not migrate the save path as part of grouping.** The attachment proposes switching the editor from direct Supabase writes to the backend workflow CRUD route. That is a large, risky change that can silently drop fields the editor saves today. Instead: keep the current save path, extract the grouping validator into one isomorphic module used by both the editor and the backend, and add the column. Move the save boundary later as its own piece of work, behind the contract fixtures the attachment describes.
2. **Make execution decoupling its own numbered stage, not a prerequisite bullet.** It is the largest and riskiest part; collapse ships only after it passes integration tests.
3. **Add a stage 0.** Before any grouping UI, introduce the canonical document provider (`getNodes`/`getEdges`/lookup/update) and a real history cursor with redo. Today's keyboard history has no independent redo path, and grouping cannot be bolted onto pop-only undo.
4. **Skip PostHog and any new analytics.** Gate with a simple local feature flag.
5. **Keep collapse out of the saved document** — agreed with the attachment, and against the older snapshot it reviews.

## Data model

```ts
interface WorkflowNodeGroup {
  id: string;            // UUID, independent of the name
  name: string;          // non-empty, unique in the workflow
  nodeIds: string[];     // real node ids, unique
  description?: string;  // plain text, max 145 chars
}
```

Saved document becomes `{ nodes, edges, nodeGroups }`. `nodeGroups` in frontend and export objects, `node_groups` in Supabase rows, mapped in one place. Missing legacy data defaults to `[]`.

Never persisted: group coordinates or size, projected edge ids, renderer `hidden` flags, synthetic nodes, execution summaries, collapse state. Bounds are derived from member positions.

Local-only view state: expanded group ids, selected group ids, measured member sizes. Only the expansion preference is stored in local storage, scoped to user and workflow.

## Grouping rules (one shared module)

`src/domain/nodeGroups/validate.ts`, imported by the editor and mirrored into the backend:

- A node belongs to at most one group; every member id exists; names unique and non-blank; no empty groups on save.
- Triggers cannot be members.
- Members must form one connected section.
- Main connections may enter through at most one member and leave through at most one member; that boundary member may have several ports. Entry must reach an internal root, exit must leave an internal leaf, with the closed-loop case allowed to exit through its Loop node.
- Non-main Coreza connections must not cross the boundary. This needs a Coreza-specific handle adapter, since our semantics are `chatModel`, `memory`, `tool` on AI Agent and `in`, `done`, `loop` on Loop — n8n's connection strings do not transfer.
- Branching inside a group is allowed; a group need not be a linear chain.

Every proposed edit (connect, disconnect, delete, replace, paste) validates a candidate graph before commit and reports an actionable reason when it is rejected.

## Stages

### Stage 0 — canonical document and history

- Add a workflow document provider exposing canonical node/edge reads and writes. Route `StableNodeContext`, rename, reference resolution, upstream-input lookup and traversal through it. Leave `useReactFlow` for genuine canvas concerns only.
- Replace the pop-only undo with a command/cursor history: one entry per user operation (a whole drag included), new mutation clears redo, snapshots cover nodes, edges and groups atomically.
- No user-visible change. This stage stands on its own and de-risks everything after it.

### Stage 1 — expanded groups

- Document mutations: create, rename, edit description, add/remove member, ungroup — each one undoable and validated.
- Creation from a selection: expand the selection to attached sub-nodes first, require at least two connectable members after expansion.
- Frame rendering with React Flow `ViewportPortal` and `getNodesBounds`, drawn behind nodes: title, description, member count, selection state. Dragging the frame moves members together; dropping a node inside or outside updates membership through the guarded mutation.
- Clipboard: copy includes group metadata only when every member is copied; paste allocates node ids first, remaps edges and `nodeIds` with the same map, mints fresh group UUIDs, resolves name collisions (`Group 1`, `Group 2`), applies one offset in one transaction; partial copies paste as plain nodes; cut is copy plus removal in one undoable step.
- Rename remaps membership atomically and never changes the group UUID.
- Persistence, versioning and export all carry groups (below).

### Stage 2 — execution decoupled from renderers

Mandatory before collapse:

- Move execution registration and submission out of visual node lifecycles into controllers owned by the workflow runtime, mounted per canonical node whether or not a renderer exists. Exactly one controller per real node; no double registration during migration.
- Dispose on node/workflow removal, never on collapse; reconcile on rename and replacement.
- Keep execution output and status in runtime state keyed by real node id; status changes never dirty the document or create history.
- Rebuild executor context on canonical node/edge changes, including same-count id or endpoint changes.
- Assert synthetic group ids and projected edge ids can never enter execution payloads, input resolution, branch routing, reference selectors or queues.

### Stage 3 — collapse

- Canvas projection only: hide members and internal edges, render a compact card, remap external edges to it while retaining their real endpoints (a projected edge may stand for several).
- Card status precedence: error, running, waiting, success, idle, with failed/running counts and no invented execution record for the group.
- Clicking a failed member in run history expands its group and focuses the real node. Search, error navigation and programmatic focus all expand the owner. Fit-view and minimap use the rendered representation.
- New groups start expanded; imported or pasted groups start collapsed. Read-only views may force expansion without writing the preference.

## Persistence, versioning, history

- Migration adds `node_groups jsonb NOT NULL DEFAULT '[]'::jsonb` with a JSON-array check to `workflows`, `workflow_versions` and `workflow_runs`; update `setup/database-schema.sql` and regenerate Supabase types. Backfill to `[]`; never infer historical groups.
- `useWorkflowPersistence` serialises `node_groups` alongside nodes and edges, runs the shared validator before writing, and includes normalised groups in the dirty hash — comparing membership as a set so reordering alone does not create a version.
- `useWorkflowVersioning`: snapshot `node_groups` with the rest, and move the snapshot-then-save pair into a single Supabase RPC that checks a revision column, inserts the prior document into `workflow_versions`, updates the new document and bumps the revision. A revision conflict rejects and reloads instead of overwriting another editor's membership.
- Run creation captures `node_groups` with its node/edge snapshot; restore-from-run uses that snapshot's groups, never today's. The execution queue payload is unchanged.
- Export moves from `1.0` to `1.1` with optional top-level `nodeGroups`; the importer accepts both and defaults to `[]`. Import ids are regenerated as today, with group UUIDs remapped through the same id map.
- Invalid groups on a normal save are rejected with structured violations. Invalid groups in an import load the executable graph expanded, list diagnostics, keep the original import recoverable, and exclude the bad metadata from projection rather than deleting it.
- With the feature flag off, every real node shows and saved metadata is preserved untouched.

## Tests

- Validator unit tests: exclusive membership, triggers, connectivity, single entry and exit, multi-port boundary members, the Loop closed-loop case, AI sub-node handles crossing the boundary, empty and duplicate names.
- Document mutations: create, rename, description limit, add/remove member, ungroup, each with undo and redo.
- Clipboard: full copy, partial copy, paste id and membership remapping, name collisions, cut.
- Rename and replacement remap membership atomically.
- Persistence: round-trip with groups, legacy rows without the column, dirty-hash behaviour, RPC revision conflict, version restore, run snapshot restore.
- Export/import `1.0` and `1.1`.
- Stage 2: a node with no renderer mounted still executes, resolves inputs, reports output and completes callbacks; exactly one listener per node; synthetic ids never reach execution payloads.
- Stage 3: projection hides members and internal edges, external edges remap, card status precedence, expand-on-focus from run history, fit-view and minimap.
- Browser checks for frame drag, membership by drop, collapse and expand.

## Verification

Run the frontend test suites plus node-schema validation, read the full output, then drive the editor in a browser: create a group from a selection, rename it, drag it, undo and redo, save and reload, export and re-import, and (after stage 2) collapse it and execute the workflow with members hidden.

## Backend repository note

Backend validator, routes and run-repository changes live in `coreza-io/coreza-backend` and must be copied across manually, as usual.

## Done when

Groups can be created, named, described, moved, copied, undone, saved, versioned, exported and re-imported without changing a single executed node or edge; collapse is purely visual and only enabled once hidden nodes provably execute; and turning the feature off leaves every workflow exactly as it behaves today.
