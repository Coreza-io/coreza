# Fix Coreza cluster dragging and theme integration

## Review conclusion

The uploaded plan identifies the two main defects correctly:

1. Compact cards cannot move because the projection sets `draggable: false`, while `WorkflowEditor.onNodesChange` discards changes whose IDs are not canonical node IDs.
2. The white compact surface is plausibly caused by two issues together: the card uses generic `bg-card`, and the active React Flow instance does not receive `colorMode={resolvedTheme}` while manually adding a dark class.

The movement architecture, position-only undo, canonical-ID resolution, theme synchronization, and browser matrix are valid and should be retained.

## Corrections required for this checkout

The uploaded review describes a newer pinned revision than the current checkout. Do not assume its “already fixed” items exist here:

- `CLUSTER_COLLAPSE_ENABLED` is still `false`; collapse remains intentionally gated on renderer-independent execution.
- Compact display IDs are allocated after edge endpoints are projected, so the collision routing defect is still present.
- `CompactClusterNode` does not call `useUpdateNodeInternals`.
- The compact control uses `ChevronRight`; the expanded control uses `ChevronDown`, not the intended compact/down and expanded/up pair.
- The compact card accepts only `data`; selected/dragging styling and logical compact selection are not implemented.

Therefore this work must preserve the runtime safety gate and include the missing projection/handle corrections before enabling compact dragging. Do not turn the capability flag on merely to test movement.

No database migration or backend change is required. Real member positions already belong to the canonical node document and existing save/export paths should persist them.

## Required behavior

- Dragging a compact card moves every canonical member by the same flow-space delta.
- Dragging the expanded header uses the same position command.
- Member spacing, edges, handles, configuration, output, and status remain unchanged.
- Expanding after a compact move reveals members at translated positions; collapsing after an expanded move derives the new card anchor without snapping.
- Release records one undo entry only when final positions differ from initial positions.
- Escape, pointer cancellation, lost capture, deletion, dissolve, workflow switch, or session change cancels safely and restores positions only.
- Toggle, menu, title, note, and other controls never start a drag.
- Save/reload persists canonical member positions; no compact node, proxy handle, selection, or theme state is persisted.
- Compact card and expanded frame use one dedicated Coreza cluster visual identity in dark, light, and system modes.
- Theme-only and selection-only changes do not dirty the workflow.

## Phase 0 — Verify the active implementation

1. Record the frontend branch/SHA used by the preview and intended release.
2. Confirm whether collapse is enabled by uncommitted/deployment-only changes; preserve the current safe runtime gate.
3. Capture the compact card's rendered classes and computed `--card`, background, and React Flow mode class in dark/light mode.
4. Establish focused test commands and baseline failures for projection, movement, theme, and active-editor browser checks.

Exit: fixes are applied to the code that actually produces the user's working compact/expanded experience.

## Phase 1 — Add canonical position commands and position-only history

Create focused pure helpers in the cluster domain layer:

```text
PositionMap = nodeId -> { x, y }

capturePositions(nodes, nodeIds)
translatePositions(initialPositions, delta)
applyPositionTargets(latestNodes, targets)
positionsEqual(before, after)
```

Rules:

- Apply targets to the latest node objects, replacing only `position`; preserve current `data`, dimensions, selection metadata, configuration, and runtime output.
- Resolve and deduplicate member IDs once at gesture start. A real node must move once even when reached through mixed node/cluster selection.
- Pure translation does not rerun topology validation on every pointer move.
- Add a movement history entry containing affected IDs plus before/after positions. Undo/redo applies the map to current nodes instead of restoring stale document snapshots.
- Keep existing full-document history for unrelated commands until separately migrated.
- A click or a drag returning exactly to its start creates no history entry and does not dirty the document.

## Phase 2 — Define one move-session lifecycle

Maintain transient movement outside persisted cluster metadata:

```text
ClusterMoveSession = {
  workflowSessionId
  source: compact | expanded
  pointerId?
  movedNodeIds
  initialMemberPositions
  initialDisplayPositions
  initialFlowPointer?
}
```

1. Start a session only for an editable cluster and only when no connection drag is active.
2. Resolve compact card ID through `displayNodeToCluster`; never parse or strip the reserved prefix.
3. Capture member positions and compact anchors once.
4. Compute every update as `initial position + total delta`, never incrementally from already moved nodes.
5. Apply the target map to the latest canonical node state.
6. Invalidate the session when workflow identity or membership changes, or when a member is deleted/dissolved.
7. Finalize before Save so serialization sees one valid canonical position set.
8. Clean up on pointerup, pointercancel, lost pointer capture, Escape, editor unmount, workflow switch, and capability shutdown.

## Phase 3 — Wire native compact-card dragging

1. Make projected compact nodes draggable only when editing and the collapse capability is safely enabled.
2. Define a card-body/title drag surface; keep buttons and future menus `nodrag nopan`.
3. Add React Flow node-drag start/stop handlers to open/finalize one move session.
4. Partition `onNodesChange` into:
   - canonical node changes, handled normally;
   - compact position changes, translated to canonical member targets;
   - compact selection changes, routed to cluster view selection;
   - synthetic dimension changes, retained only for view measurement;
   - synthetic add/remove/replace changes, rejected unless an explicit adapter owns them.
5. Use the reported compact position minus its initial compact position as the total flow-space delta. Do not divide by zoom again.
6. Apply movement only in the change adapter; drag callbacks own lifecycle only, preventing double application.
7. Reprojection must derive the compact anchor from moved real members, so no synthetic position is stored and no snapback occurs.

## Phase 4 — Refactor expanded-header dragging to the same command

Replace the current whole-document baseline and restoration path.

- Use pointer capture on the header drag surface.
- Convert the initial and current pointer through `screenToFlowPosition`; calculate one total flow-space delta.
- Apply position targets to latest canonical nodes.
- Escape/cancel restores only captured positions.
- Suppress conflicting canvas gestures for the active custom drag, or explicitly support viewport changes through flow-coordinate conversion.
- Inputs, title editing, toggle, and menu controls stop pointer propagation and cannot acquire the drag.
- Compact and expanded movement finalize through the same position-history operation.

## Phase 5 — Complete logical selection and command routing

- Track selected cluster IDs in canvas view state and project `selected` onto compact nodes.
- Preserve multi-selection when right-clicking an already selected card; selecting an unselected card targets its cluster, not a missing canonical synthetic ID.
- Resolve selected clusters and ordinary nodes into one deduplicated canonical node set.
- Ensure mixed movement produces one coherent delta and one history entry.
- Keep context menus, keyboard commands, Delete, Dissolve, Copy/Cut/Paste, and dragging on one explicit canonical target-resolution path.
- Selection remains view-only and must not enter save/export, dirty hash, versions, runs, or execution.

## Phase 6 — Correct projection prerequisites

Before compact dragging is released:

1. Allocate every final collision-safe compact display ID first.
2. Store one cluster-to-display and display-to-cluster map.
3. Project boundary edges only after that map exists, so collision-suffixed cards receive their actual endpoints.
4. Preserve canonical edge identity and original endpoint/handle metadata.
5. Keep one displayed boundary edge per canonical edge.
6. Add `useUpdateNodeInternals` in the compact renderer and refresh from a stable handle-ID/position signature, not newly allocated array references on every movement.
7. Keep compact handles non-connectable and outside any clipping surface.
8. Retain the runtime safety requirement: dragging must not be used as justification to enable collapse before hidden-member execution is renderer-independent.

## Phase 7 — Fix React Flow theme ownership

At the active `WorkflowEditor` React Flow instance:

```tsx
<ReactFlow
  colorMode={resolvedTheme}
  className="workflow-canvas"
  ...
/>
```

- Remove the manually appended local dark class so React Flow owns one effective mode class.
- Inspect other actively mounted React Flow views and align only those with the same mismatch; do not assume the separate `WorkflowCanvas` fixes the editor.
- Verify dark mode resolves a dark `--card`, light mode resolves a light value, and no nested contradictory mode classes remain.
- Keep the current canvas grid/background semantic tokens.

## Phase 8 — Synchronize system theme correctly

Use one resolved-theme source for the document root and consumers.

- When preference is `system`, subscribe once to `prefers-color-scheme` changes.
- Update the root `light`/`dark` class and exposed resolved value together.
- Remove the listener on cleanup.
- Preserve the saved preference value as `system`; do not replace it with the momentary resolved mode.
- Verify explicit light/dark and live system light-to-dark/dark-to-light transitions without reload.

## Phase 9 — Add semantic cluster visual tokens

Use a dedicated deep petrol/teal cluster identity, but define every color, gradient, and shadow as semantic tokens in global CSS for both themes. Do not hardcode hex/rgba values inside the cluster component.

Suggested roles:

```text
--cluster-surface-start
--cluster-surface-end
--cluster-surface-highlight
--cluster-accent
--cluster-border
--cluster-title
--cluster-muted
--cluster-selection-ring
--cluster-shadow
```

Expose these through Tailwind/theme utilities or a small cluster visual contract. Keep this separate from executable node categories; do not register Cluster in node manifests or backend registries.

Apply the same identity to both representations:

- compact card: deep petrol/teal gradient, accent Network icon, readable title/note/count, coordinated handles, subtle hover, clear selected/focus ring, and grab/grabbing cursor;
- expanded frame: matching header and border, with only a faint transparent body tint so member nodes retain their own category colors;
- running/error indicators stay visually distinct from selection;
- preserve current compact dimensions to avoid unrelated geometry changes;
- no edge recoloring solely because an endpoint belongs to a cluster.

Use the design tokens to meet contrast in dark/light modes; treat the uploaded palette values as starting references, not component literals.

## Phase 10 — Correct controls and accessibility while touching the renderer

- Use downward chevron to expand the compact card and upward chevron to collapse the expanded frame, matching the reference.
- Accept React Flow `selected` and `dragging` props in `CompactClusterNode`.
- Keep explicit `aria-label`, `aria-expanded`, tooltips, keyboard Enter/Space behavior, and focus-visible ring.
- Ensure double-click expands without also starting/ending a drag.
- Toggle/menu/input clicks create no movement history entry.
- Respect reduced motion for running/hover transitions.

## Tests

### Pure/domain tests

- Applying a position map changes only targeted positions and preserves latest node data.
- Translation preserves internal spacing and ignores unrelated nodes.
- Duplicate mixed targets move once.
- Undo/redo and cancel restore positions only.
- No-op movement creates no history entry.
- Collision-suffixed card IDs map edges and drags to the correct cluster.
- Compact projection remains canonical-input immutable.

### Editor integration tests

- Compact position changes translate every real member once.
- Synthetic dimensions/add/remove never enter the canonical document.
- Compact selection and mixed node/cluster movement resolve canonical targets.
- Expanded and compact adapters share movement semantics.
- Output/configuration arriving mid-drag survives move, cancel, undo, and redo.
- Delete/dissolve/workflow switch invalidates the move session without resurrecting nodes.
- Save during/after movement serializes real member positions only.

### Browser acceptance in active `WorkflowEditor`

Using the user's three-member cluster:

1. Drag compact card, expand, and verify translated member positions and unchanged spacing.
2. Drag expanded header, collapse, and verify the anchor follows without snapback.
3. Repeat at zoom 0.5, 1, and 2 and after canvas pan.
4. Verify click-only, move-back-to-start, controls, Escape, pointer cancellation, and one-step undo/redo.
5. Move connected compact clusters and verify boundary edges/handles stay attached.
6. Save/reload/export and verify canonical member positions persist with no display IDs.
7. Verify dark mode has no white card; light mode has a readable pale treatment; system mode updates root, flow, card, and frame together.
8. Verify selected, dragging, running, error, focus, and reduced-motion states.
9. Smoke-test deterministic execution to ensure movement/style changes do not alter or duplicate runtime behavior.

## Completion gate

The repair is complete when compact and expanded movement both translate canonical members through one position command, undo/cancel never restores stale runtime data, save/reload preserves the move, collision-safe projection remains correct, and compact/expanded clusters share a readable tokenized petrol/teal identity under one synchronized React Flow/app theme. Collapse remains gated until its separate hidden-member runtime requirements pass.