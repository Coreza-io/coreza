# Complete Coreza node clusters and safe expand/collapse

## Updated review verdict

The attached recommendation is sound and materially improves the previous plan. It correctly requires continuing the implementation already present instead of creating a second menu, frame, history system, or validator.

The current checkout now contains more than the earlier plan stated:

- The active `WorkflowEditor` has selection, node, and pane context-menu handlers plus a portaled menu.
- Create/dissolve actions, expanded cluster frames, editable title/note controls, member dragging, cluster-aware history/clipboard state, invalid-metadata recovery, and canonical graph synchronization have been started.
- `documentCommands.ts` includes delete and rename helpers.
- The validator work has advanced beyond the original foundation.

However, code presence is not end-to-end completion. Several active UI paths still bypass the helpers, title/note inputs mutate persisted metadata per keystroke, menu actions synthesize keyboard events, collapse is absent, and runtime behavior still depends on rendered node components.

The connected database was queried and currently has **none** of the expected `node_clusters` or `revision` columns on `workflows`, `workflow_versions`, or `workflow_runs`. This directly explains the current generated-query type failures. The repository code and deployed schema are out of sync.

Keep the Coreza-owned schema and terms `NodeCluster`, `clusters`, `memberNodeIds`, `title`, `note`, and `node_clusters`, including the existing 200-character note limit. Do not introduce a competing group schema or copy external naming, text, limits, visuals, source, or algorithms.

## Phase 0 — restore a clean build before further grouping work

Resolve the reported build failures as one compatibility checkpoint.

### Edit Fields row typing

In `RepeaterNodeLayout.tsx`, change the `EditFieldEditor` contract to accept `TypedEditFieldRow` (or a minimal shared row interface) rather than requiring `Record<string, unknown>`. Do not hide the mismatch with a broad cast or add an index signature to domain data solely for JSX compatibility. Preserve all existing typed and legacy row behavior.

### Drag-reference narrowing

In `referencePath.ts`, narrow `sourceNodeId` into a local `string | undefined` before calling `createJsonReferenceDragPayload`. Do not pass an un-narrowed `unknown` property through a conditional expression.

### Context-menu event type

Make `openCanvasMenu` consume only the event fields it needs—`clientX`, `clientY`, `preventDefault`, and `stopPropagation`—or provide a shared structural event type compatible with both React Flow’s pane event and React synthetic mouse events. Do not cast the browser event to `React.MouseEvent`.

### Database and generated contracts

Apply an additive database migration through the migration tool:

- `workflows.node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb`;
- `workflow_versions.node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb`;
- `workflow_runs.node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb`;
- `workflows.revision bigint NOT NULL DEFAULT 0` if no equivalent revision column exists at migration time.

These are alterations to existing tables, so preserve current grants and RLS policies. Regenerate frontend and backend database contracts from the deployed schema; do not manually patch `src/integrations/supabase/types.ts`.

Then make execution history map database rows through a typed adapter instead of unsafe direct array casts. Treat missing cluster metadata from legacy/API fixtures as `[]`, but keep the persisted column non-null after migration. Version-history and persistence queries should compile naturally against regenerated types.

### Build gate

Run the targeted Edit Fields/reference tests, cluster/version/history tests, frontend type/build checks through the normal harness, and backend workflow tests. No collapse implementation starts until this gate is clean.

## Phase 1 — establish one canonical document owner

Use one authoritative editor document:

```text
WorkflowDocument = {
  nodes: Node[]
  edges: Edge[]
  clusters: NodeCluster[]
  revision: number
}
```

Provide synchronous `getDocument()` and `dispatchCommand()` APIs through a reducer/store. React Flow becomes a projection and interaction surface, not a second canonical store synchronized after rendering.

Separate the three state classes:

- **Document:** persisted node configuration and positions, canonical edges/handles, cluster identity/title/note/membership, and intentionally persisted pinned output.
- **Runtime:** inputs/outputs, registration, listeners, execution status, callbacks, stream cursors, and cancellation.
- **View:** cluster expansion, logical selection, edit drafts, drag previews, measured dimensions, menu position, and viewport.

Create one explicit persisted serializer used by save requests, dirty hashing, export, and document-history snapshots. It must:

- deeply copy persisted nested parameter values;
- preserve supported pinned output;
- exclude definitions, callbacks, selection, measurements, menu state, expansion state, ordinary execution output, and running/error status;
- rehydrate definitions and UI callbacks after load/restore.

Selection, pan/zoom, execution progress, menu opening, and cluster expand/collapse must not dirty the workflow or create history.

## Phase 2 — complete command-specific mutation policies

Refactor `documentCommands.ts`; do not use the current generic “dissolve every newly invalid cluster” behavior for all mutations.

Define explicit command outcomes:

- **Create/retitle/note:** validate identity, duplicate/blank title rules, note limit, membership, attachment ownership, and topology; commit once.
- **Rename real node:** atomically remap node ID, edge endpoints, references handled by the existing rename behavior, and every cluster membership.
- **Delete/cut members:** prune membership, remove empty clusters, retain valid singletons, and dissolve only metadata for invalid survivors.
- **Connect/reconnect/delete edge:** validate the candidate before commit. Reject without changing the graph; optionally expose an explicit **Dissolve cluster and apply** action.
- **Replace node/dynamic handle change:** resolve resulting handle semantics and validate affected clusters before commit.
- **Paste/duplicate/restore/import:** allocate/hydrate/remap first, validate the complete candidate, and commit once.
- **Move cluster:** preview every member against one fixed flow-space baseline; commit each final position once on drop; Escape cancels.

Route every structural entry point through these commands: node-card controls, `useNodeRenaming`, keyboard handlers, context menus, edge removal callbacks, connection/reconnection, palette insertion, import, restore, and cluster frame actions. `NodeWrapper` must not directly delete React Flow nodes and edges.

Replace shallow history copies with deeply isolated persisted document snapshots or immutable command history. Maintain past/future stacks; a committed edit clears redo. Runtime and view changes never enter history.

Delayed toast/menu actions store intent plus expected revision—not stale candidate arrays. Rebuild and revalidate against the latest document when invoked.

## Phase 3 — finish validator parity

Extract dependency-free graph rules that frontend and backend adapters can both call. Package/build them compatibly for frontend ESM and backend CommonJS; do not import raw frontend TypeScript outside the backend root.

### Attachments

- Traverse owner to required dependency only.
- Inspect every owner of each included dependency, including recursively discovered dependencies.
- Selecting a dependency alone cannot pull all owners into a cluster.
- Reject a dependency shared with an owner outside the intended membership.

### Handles

- Resolve static handles and supported dynamic handles from authoritative node definitions.
- Permit an omitted default only for node types that explicitly support it.
- Reject stale, removed, or misspelled explicit IDs as `unknown-semantics`.
- Match actual Switch case/fallback and Loop handle rules.

### Loop topology

Model the supported Coreza `in`, `loop`, and `done` routes. Permit only executor-backed closed-loop shapes, not arbitrary cycles or extra invalid boundaries.

### Shared fixtures

Frontend and backend must produce the same stable reason codes and implicated node/edge IDs for identity, titles, membership, overlap, triggers, attachments, connectivity, entry/exit, Loop, and handle cases. Pair each allowed Loop topology with an executor fixture.

## Phase 4 — finish the existing menu and expanded frame

Improve the active `WorkflowEditor` implementation; do not add a menu to unused `WorkflowCanvas`.

### Context menu

- Resolve one logical target for selection, node, pane, and cluster header/card right-clicks.
- Preserve a multi-selection when right-clicking a selected node.
- Make an unselected right-clicked node the target selection.
- Pane actions cannot retain stale node IDs.
- Clamp the measured portaled menu to the viewport.
- Close on Escape, outside click, pan/zoom, navigation, or completed action, then restore focus.
- Disable structural actions in read-only mode or during connection drag.
- Add keyboard navigation and clear disabled reasons.

Remove synthetic `KeyboardEvent` dispatch from Copy/Paste menu actions. Extract and call `copySelection`, `pasteSelection`, `deleteSelection`, and `createClusterFromSelection` directly. Shortcuts and menus invoke the same functions and produce equivalent document changes.

### Expanded frame

Retain one cluster view component mounted by the active editor:

- calculate bounds from canonical member positions and measured/fallback dimensions;
- keep the frame body pointer-transparent;
- isolate header/toggle/input gestures from node drag and canvas pan;
- drag from a fixed flow-space baseline with zoom applied exactly once;
- cache member dimensions so virtualization cannot collapse bounds to zero;
- move each real node once even with overlapping logical selections;
- commit one history entry at drag completion.

### Draft editing

Replace per-keystroke cluster mutation with local `draftTitle` and `draftNote`:

- Enter or valid blur validates and commits once;
- Escape restores the original value and creates no history entry;
- duplicate/blank titles keep editing active with an actionable message;
- note is plain text and remains limited to 200 characters;
- toggles and inputs do not start frame dragging.

## Phase 5 — make save authoritative and atomic

The editor currently writes graph data directly to Supabase, so backend validation does not govern every save. Move canonical workflow saves to one authenticated backend endpoint.

### Save contract

Request:

- workflow ID;
- expected revision;
- supported name/project/settings;
- serialized real nodes and real edges;
- normalized clusters.

Response:

- authoritative normalized saved document;
- incremented revision.

Omitted `node_clusters` preserves existing metadata on partial updates; explicit `[]` clears it. Merge all supplied fields with the owned stored document before semantic validation. Resolve node and handle semantics from server-owned definitions, not browser-supplied definition objects.

Inventory every currently persisted field and supported writer before switching. Ensure positions, canonical handles, node values, stream/execution configuration, project fields, and pinned output are not stripped. Retire direct graph writes only after all supported clients use the endpoint; RLS remains necessary but is not topology validation.

### Atomic version and save transaction

Implement a narrowly scoped transaction/RPC used only after backend ownership and semantic checks:

1. Load and lock the owned workflow.
2. Compare `expectedRevision`.
3. Reject conflicts without overwriting the local draft.
4. Normalize and validate the exact candidate tied to that revision.
5. Insert the prior meaningful document as a version.
6. Update the complete workflow and increment revision.
7. Apply version-retention policy.
8. Commit both changes or neither.

A normalized no-op save returns the current revision without a needless version. If the user edits during an in-flight save, mark only the acknowledged snapshot saved; newer edits remain dirty.

Test concurrent revision-N saves, version/update failures, edits during save, no-op saves, and cluster-metadata-only saves.

## Phase 6 — complete recovery, clipboard, restore, and snapshots

### Recovery

Load/import in this order: parse raw metadata, hydrate registered node types and dynamic handles, then validate semantics. Preserve malformed and topology-invalid raw entries until the user explicitly repairs, dissolves, or removes them. An unrelated save must not silently discard recovery data.

### Clipboard

- Include metadata only when every member is copied.
- Allocate real node IDs first; remap edges and memberships through the same map.
- Mint new cluster UUIDs and collision-free titles.
- Commit one complete paste action.
- Never copy frame/card/projection IDs.

### Restore and run snapshots

Version/run restore uses nodes, edges, and clusters from the same historical snapshot. Missing legacy metadata means `[]`, never current clusters.

Audit manual, backtest, scheduler, streaming, webhook, and any other run creators. Store exact cluster metadata with each run while execution receives only canonical real nodes and edges. Add `node_clusters` to every relevant repository selection, including activation.

## Phase 7 — extract renderer-independent runtime controllers

Do not enable true collapse until a real node can execute without its visual component ever mounting.

Create one workflow-owned controller per canonical real node with explicit inputs such as:

```text
NodeRuntimeController({
  nodeId,
  workflowId,
  workflowSessionId,
  getCanonicalDocument,
  getNodeConfiguration,
  executionStore,
  submitNode,
  resolveCredentials
})
```

Move semantic graph reads and runtime ownership out of `BaseNode`/React Flow context:

- field/configuration access needed for execution;
- credential resolution;
- upstream input resolution;
- submission and output publication;
- auto-execution/listener registration;
- callbacks, errors, cancellation, pinned-output behavior;
- stream pause/resume and cursor handling.

`StableNodeContext` reads the canonical document owner, never the display projection. Visual node cards subscribe to controller state and invoke commands; they do not own the only listener or submit path.

Reconcile controllers explicitly on rename, replacement, and deletion. Invalidate executor context on structural content/revision changes, not only node/edge array length.

Hard gate: a never-rendered node resolves inputs, executes, publishes output, and settles callbacks. Repeated view toggles retain exactly one controller/listener and deletion disposes it once.

## Phase 8 — implement node-style expand/collapse as view projection

Expansion is view state, not document data:

```text
clusterViewState[clusterId] = {
  expanded: boolean,
  selected: boolean,
  editingTitle: boolean
}
```

New clusters open expanded for naming. Loaded clusters use a user/workflow preference when available, otherwise default compact. During the expanded-only release, force expansion and do not expose a nonfunctional collapse control.

Follow the existing node behavior contract:

- compact card expands on double-click or an accessible chevron button;
- expanded header collapses through the paired button;
- `Enter`/`Space` activates a focused toggle;
- Escape exits editing first;
- buttons stop propagation and never start drag;
- use `aria-expanded`, `aria-controls`, and explicit tooltips;
- use stable dimensions, restrained transitions, and reduced-motion support.

### Display projection

Use a display-only custom React Flow node for each compact cluster card. It is not a Coreza executable node.

Maintain a projection index:

```text
clusterByDisplayNodeId
a realEdgeIdsByDisplayEdgeId
canonicalEndpointsByRealEdgeId
```

Correct key name in implementation: `realEdgeIdsByDisplayEdgeId`.

Projection rules:

- canonical nodes and edges remain unchanged;
- expanded clusters show real members and real edges inside a frame;
- collapsed clusters omit member visuals and internal display edges only;
- each external edge maps to the compact card while retaining original real endpoint, handle, and edge ID;
- map both ends for edges between collapsed clusters;
- initially keep one display edge per real edge;
- if aggregation is added later, deletion must choose a real edge or expand the cluster—never delete several silently;
- display handles are non-connectable in the first release;
- use reserved collision-safe display IDs that cannot enter serialization, runtime traversal, references, clipboard, node counts, backtests, or queue payloads.

Anchor the compact card to a derived expanded-frame corner. Toggling alone never moves canonical members or dirties history. Dragging either representation moves all members once from a fixed baseline. Search/error/history focus expands the owning cluster before centering the real node. Fit-view and minimap use only the intended display representation.

## Phase 9 — rollout, performance, and release gates

### Two usable releases

1. **Expanded release:** clean build, canonical commands, validator parity, menu/frame/editing, authoritative persistence, recovery, and snapshot parity. All clusters remain expanded; collapse is unavailable.
2. **Compact release:** runtime-controller gate passes, then enable compact projection and local expansion preferences.

Use a local capability flag, not a new analytics dependency. Turning the feature off displays every real node and preserves stored cluster metadata. A visual rollback never writes an empty cluster list or changes execution.

### Performance

Establish baselines before selecting numeric budgets. Reuse graph indexes per command; never rebuild topology on pointer movement or runtime-status updates. Memoize ownership, bounds, and projection data. Add a stress fixture with many clusters/members plus streaming updates during drag; monitor responsiveness, memory, and controller counts.

### Acceptance matrix

**Build/schema**

- All reported TypeScript failures are resolved without unsafe broad casts.
- The migration is applied and regenerated contracts include all three `node_clusters` columns plus revision.
- Frontend and backend builds and focused tests pass.

**Commands/editing**

- Menu and shortcut creation produce the same normalized change and one history entry.
- Node rename/card delete/cut/edge/dynamic-handle paths use canonical commands.
- Title/note Enter and valid blur commit once; Escape restores the original.
- Nested history snapshots cannot be mutated by later parameter edits.

**Persistence**

- Metadata-only edits save/version correctly.
- Concurrent saves conflict safely.
- Failures commit neither version nor document.
- In-flight subsequent edits remain dirty.
- Legacy, malformed, and topology-invalid metadata follow the defined recovery rules.

**Collapse/runtime**

- Ungrouped, expanded, and collapsed fixtures produce equivalent canonical inputs, outputs, routing, and counts.
- Collapse during execution/streaming preserves callbacks and delivery.
- Repeated toggles create no duplicate registration, submission, history, or dirty state.
- Loop, branches, and attachment dependencies behave identically.
- Expansion restores exact original edge IDs and handles.
- Keyboard, focus, reduced motion, movement, dimensions, and feature-off rollback pass.

**Browser acceptance**

Exercise the active editor: right-click create, shortcut create, invalid reason, title/note commit and cancel, drag, undo/redo, copy/paste, save/reload, restore, collapse/expand, execute while collapsed, error focus, dissolve, delete nodes, and viewport-edge menu placement. Record tested frontend/backend revisions, migration version, build/test results, and browser evidence.

## Delivery order

1. Fix the active build and deploy/regenerate the missing database contract.
2. Reconcile callers and establish the canonical document owner/serializer.
3. Complete command-specific policies and immutable undo/redo.
4. Finish shared validation and frontend/backend fixture parity.
5. Finish the existing menu, expanded frame, and draft editing.
6. Add authoritative revisioned save, atomic versioning, recovery, and all snapshot paths.
7. Ship the expanded-only release.
8. Extract renderer-independent runtime controllers and pass the never-rendered-node gate.
9. Add compact React Flow projection, node-style toggles, focus/selection mapping, and preferences.
10. Run the integrated compact release matrix and performance checks.

## Definition of done

Users can create, edit, move, copy, restore, collapse, expand, and dissolve Coreza clusters while every real node executes identically. Every structural entry point commits one validated canonical document; saves and versions are atomic and conflict-safe; malformed metadata is never silently lost; and no synthetic display object enters the executable or persisted graph.
