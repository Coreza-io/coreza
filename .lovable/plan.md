# Cluster expansion isolation and labelled Execute control

## Goal

Opening a cluster must enter a focused editor view containing only that cluster’s canonical members, internal edges, and expanded frame. Unrelated nodes and sibling cluster cards temporarily disappear and cannot be selected or changed. Closing the cluster restores the complete overview without changing positions, membership, runtime state, or saved workflow data.

The expanded frame gets a centred, full-width-style **Execute** control. The compact cluster keeps its bottom-centre icon control, revealed on hover or keyboard focus. Both presentations call the existing cluster coordinator; only explicit Run All remains batch execution.

## Verified current state

- `projectClusterGraph` currently expands a cluster by leaving the full canonical graph visible. It does not isolate the expanded cluster, so unrelated nodes and sibling compact cards can show through its frame.
- `WorkflowEditor` renders a frame for every cluster marked expanded. `ClusterViewState` is a map of independent booleans, so multiple clusters can currently be expanded simultaneously.
- Expanded frames are display overlays computed from canonical member positions and measured/fallback dimensions. Overlap with a sibling card does not prove incorrect membership.
- Collapsed members stay mounted as invisible runtime hosts. Their canonical IDs, data objects, listeners, and editor actions survive collapse. Focus mode must reuse this pattern rather than React Flow’s `hidden` flag or graph filtering that unmounts nodes.
- The projection already supplies `hiddenRuntimeHostIds`, and Fit View plus MiniMap partly consume it. It does not expose one explicit visible-ID authority for all focus interactions.
- `ClusterExecutionControl` always renders `ExecutionIconButton`. The checked-out `ExecutionIconButton` is icon-only; the uploaded document’s claimed labelled shared presentation is not yet present here.
- `CompactClusterNode` currently renders its icon at all times, not only on hover/focus. Its footer is already bottom-centred.
- The expanded footer is already centred, but still receives the icon-only cluster control.
- Cluster execution already receives canonical nodes/edges/clusters, acquires the shared editor lock, and executes an editor-local sequence of normal node actions. No execution, API, worker, database, or persistence change is required.

## Behaviour contract

| State | Visible graph | Cluster control |
| --- | --- | --- |
| Overview | Ordinary ungrouped nodes and compact cards for collapsed clusters | Icon Play on compact-card hover/focus |
| Cluster focused | Focused cluster’s canonical members, internal edges, and one expanded frame | Always-visible labelled Execute |
| Focused cluster running | Same focused graph and live results | Labelled Stop/progress state |
| Focus closed | Exact overview restored | Compact hover/focus Play |
| Cluster dissolved/deleted | Focus clears; remaining canonical graph is shown | Ordinary node/cluster controls |

- Exactly one cluster can be focused.
- Visibility is determined only by valid `memberNodeIds`, never geometry.
- External nodes may still supply existing captured outputs/references, but focusing or executing the cluster must not run or mutate them.
- Focus is editor-local presentation state: it is excluded from save/export, execution payloads, and document undo snapshots.
- Opening, closing, or switching focus during an active editor execution is blocked by the existing execution lock to avoid changing the visible target midway through a run.

## Implementation plan

### 1. Add an explicit focus model

Replace “any number of expanded booleans” as the editor’s active navigation model with one explicit focused cluster ID.

- Add pure helpers in `src/domain/clusters/viewState.ts` for opening, closing, validating, and reconciling `focusedClusterId: string | null` against current clusters.
- Keep compatibility conversion helpers only where an existing projection/test still needs the old expanded map during migration; remove duplicate sources of truth when all callers are moved.
- Route compact-card button activation, compact-card double-click, newly created cluster opening, and any programmatic open through `openCluster(clusterId)`.
- `openCluster` must verify the cluster exists, reject the transition while an editor execution or cluster drag is active, capture the overview viewport only on entry from overview, clear menus/editors belonging to hidden objects, clear hidden selections, and focus the requested cluster.
- Opening a second cluster replaces focus without overwriting the originally captured overview viewport.
- Route the expanded header Collapse action through `closeCluster()`, which clears focus and restores the captured overview viewport.
- Clear stale focus when the workflow session changes, import/restore replaces the document, undo/redo removes or dissolves the cluster, deletion/dissolve removes it, or reconciliation finds no valid members.
- Do not put focus or saved viewport state in workflow documents, cluster metadata, node data, history entries, or persistence calls.

### 2. Make focused projection membership-authoritative

Extend `projectClusterGraph` options with `focusedClusterId` and derive all presentation sets in one place.

Overview mode remains unchanged:

- collapsed member components remain invisible runtime hosts;
- one synthetic compact card represents each collapsed cluster;
- boundary edges are projected to synthetic handles.

Focused mode:

- validate the focused cluster against canonical clusters and canonical node IDs;
- define `visibleCanonicalNodeIds` from that cluster’s valid, deduplicated member IDs only;
- emit focused members as ordinary canonical node render objects with stable IDs/data/component keys;
- decorate every other canonical node as an invisible, non-interactive runtime host using one shared helper;
- do not emit any compact synthetic cluster card, including the focused cluster’s card and sibling cards;
- emit only canonical edges whose source and target are both focused members;
- suppress boundary, sibling, and unrelated edges without deleting or mutating them;
- return authoritative `visibleNodeIds` and `hiddenRuntimeHostIds` from the same derivation for Fit View, MiniMap, selection, keyboard actions, and tests.

The hidden-host decoration must preserve current safeguards: `visibility:hidden`, no pointer events/transitions/animations, `aria-hidden`, and disabled drag/select/connect/delete/focus. Keep the canonical `data` object and all runtime ownership intact. Never use React Flow’s `hidden` property, remove canonical nodes, write projected nodes into editor history, or persist synthetic IDs.

### 3. Integrate focused visibility into editor interactions

Use the focused projection consistently throughout `WorkflowEditor`.

- Pass `focusedClusterId` into the projection and feed React Flow the projected nodes/edges.
- Render exactly one expanded frame for the focused cluster rather than mapping every independently expanded cluster.
- Compute frame bounds from valid canonical members using current measured dimensions and existing fallbacks, including header/footer/padding.
- Use projection `visibleNodeIds` for Fit View, MiniMap inclusion, rectangle selection, context menus, copy/delete/group shortcuts, and canonical selection resolution.
- Clear selection on nodes and compact clusters that become hidden. Keep selected focused members only when explicitly intended.
- Ensure `onNodesChange` continues accepting mutations only for canonical visible members or the currently valid display card; hidden hosts cannot be moved, selected, connected, removed, or dimension-replaced through projection events.
- Close canvas context menus and node-owned popovers/panels when their owner becomes hidden. Confirm portalled UI cannot remain interactive after focus changes.
- Prevent hidden/sibling targets from connection gestures, keyboard Delete, drag groups, context menus, and cluster-header moves.
- In focused mode, dragging the expanded header moves only the focused cluster’s current members; stale prior selection must not add outside nodes.
- Preserve pan/zoom and member editing inside the frame. The frame body remains pointer-transparent while header/footer stay interactive.
- If cluster collapse support is disabled, force focus to `null` and retain the legacy full graph; do not apply partial isolation to an unprojected graph.

### 4. Manage viewport entry and restoration deterministically

- Capture the exact React Flow overview viewport before the first focus transition.
- After the focused members have valid measurements, fit once to the projection’s visible members with padding for the frame header and footer.
- Do not refit on execution status, output updates, hover, or every node measurement change.
- When switching directly from cluster A to B, fit B but keep the original overview viewport snapshot.
- On close, restore the captured overview viewport once and clear the snapshot.
- If the viewport restore is impossible after a workflow/session replacement, use the normal overview Fit View fallback rather than applying stale coordinates.
- MiniMap must omit hidden runtime hosts and absent compact cards, while preserving its normal overview behavior after close.

### 5. Add one icon/labelled cluster control contract

Extend the current shared execution button rather than creating a second execution implementation.

- Add `presentation?: "icon" | "labelled"` to `ExecutionIconButton` (or rename it to `ExecutionControl` only if all callers/tests move atomically); default to `icon` for compatibility.
- Share one activation guard, phase mapping, blocked reason, status description, Execute callback, and real Stop callback across both presentations.
- Icon presentation keeps `size="icon"`, secondary styling, fixed dimensions, Tooltip, Play/Spinner/Stop icons, accessible name, pointer isolation, and duplicate-activation guard.
- Labelled presentation uses the existing `nodeExecute` variant, normal button height, full-width content, and visible **Execute**, **Executing…**, **Stopping…**, or **Stop** text as applicable.
- Do not apply icon-only dimensions to the labelled control.
- Idle, completed, cancelled, and failed states permit retry. Running permits Stop only through the existing cluster cancel callback. Blocked/stopping states reject activation and expose their reason.
- Keep `type="button"`, `nodrag`, `nopan`, keyboard support, `aria-busy`, accessible status text, reduced-motion behavior, and the 250 ms duplicate guard.
- Preserve the existing reactive session lock as the concurrency authority; the visual guard is not a replacement.

Update `ClusterExecutionControl` with a presentation prop and forward all existing state/callback data unchanged. It must continue calling only `executeCluster(cluster.id)` and `cancelRun(cluster.id)`.

### 6. Apply the two cluster presentations

Compact cluster:

- pass `presentation="icon"` explicitly;
- add a named hover group to avoid nested group collisions;
- hide the idle icon with opacity and disabled pointer events until card hover or focus-within, regardless of selection;
- keep the control keyboard-focusable so Tab reveals it;
- keep the action band within the card hover boundary so pointer travel to the button does not hide it;
- retain the bottom-centre position without covering handles or changing card geometry;
- keep running/stopping/failed/blocked status visible even when the pointer leaves, so cancellation and failure feedback remain discoverable;
- clicking/double-clicking the control must not expand, drag, pan, or select the card.

Expanded frame:

- pass `presentation="labelled"`;
- place it in a centred bounded-width wrapper in the existing 52 px footer so `w-full` does not stretch across a very wide cluster;
- retain bottom-centre positioning at all zoom levels and ensure it does not overlap the fixed Run All control near the viewport bottom;
- use the same cluster state object and callbacks as the compact control, so switching presentation never starts, cancels, or duplicates a run.

### 7. Preserve execution, runtime, and persistence boundaries

- `useClusterExecution` continues planning from the complete canonical nodes, edges, and clusters, not projected/visible collections.
- A focused cluster still executes each eligible member once in dependency/control order through registered normal editor actions.
- BacktestInit initializes once, OnBar advances one manual step, and only Run All performs historical batch replay.
- Hidden external nodes never execute merely because their output/reference feeds a focused member.
- Individual member execution uses canonical IDs and updates the same output/error stores.
- Focus transitions do not unregister editor actions, remount runtime owners, reset listener/Loop/Consolidator state, clear outputs, or alter pins.
- Save/export/reload while focused serializes the same canonical workflow as overview, apart from genuine user edits. Projection flags, focus state, viewport snapshot, display IDs, and filtered display edges must never leak into persisted state.
- No backend route, API payload, migration, database table, queue, worker, or output contract changes are part of this work.

### 8. Add regression coverage before acceptance

#### Unit tests

- Focus helpers allow one focused cluster, switch deterministically, and clear stale IDs.
- Overview projection remains byte-for-byte compatible with existing compact projection behavior.
- Focus projection exposes only valid members as visible; all other canonical nodes remain hidden runtime hosts.
- No synthetic cluster cards appear in focus mode.
- Only internal member-to-member edges render; canonical edge inputs remain unchanged.
- Geometry never changes membership-derived visibility.
- Repeated open/switch/close cycles preserve canonical node/edge objects, positions, runtime data, and collision-safe IDs.
- Focused selection excludes hidden nodes and stale selected sibling clusters.
- Shared control maps every phase correctly in icon and labelled presentations and invokes one handler per activation.

#### Runtime/component tests

- Runtime owners mount once across overview, focus A, focus B, and close; listeners/actions publish once and never unregister prematurely.
- Cluster execution receives the full canonical graph while the canvas receives the focused projection.
- Saving/exporting from focus contains no focus/projection decorations.
- Dissolve/delete/undo/redo/import/session change clears or reconciles focus correctly.

#### Browser acceptance fixture

Create a realistic fixture matching the reported arrangement: one outside Store feeding four disjoint clusters, with member coordinates intentionally overlapping sibling card/frame space and including Loop and branch nodes.

Verify:

1. Overview shows the outside node and four compact cluster cards.
2. Opening cluster A shows only A’s members, internal edges, and frame in the first stable painted state.
3. Sibling cards, outside nodes, boundary edges, descendants, handles, menus, and pseudo-elements are visually absent and non-interactive.
4. Fit View and MiniMap use only focused visible objects.
5. Hidden objects cannot be rectangle-selected, dragged, connected, context-clicked, copied, grouped, or deleted by keyboard.
6. Opening B replaces A without losing the original overview viewport; closing restores all cards/nodes/edges and viewport.
7. Repeated open/close has no visibility transition glitch, duplicate mount, lost output, or permanent hidden node.
8. Expanded labelled Execute and compact hover/focus Play invoke the same cluster once and produce identical member outcomes.
9. Running presentation supports existing cancellation and remains visible; blocked/failure reasons remain accessible.
10. Member Execute, output panels, external captured inputs, pins including falsy values, listeners, Loop, and Consolidator retain existing behavior.
11. Dissolve, delete, undo, redo, save, reload, export, and history restoration leave canonical membership and visibility correct.
12. Keyboard navigation, light/dark themes, reduced motion, pan/zoom, long titles, very wide clusters, and frame-near-viewport-bottom layout remain usable.

Run focused Jest suites, the targeted Playwright fixture/spec, changed-file lint, TypeScript checks, and `npm run build`. Record exact commands, request counts, screenshots, runtime mount counts, and failures; separate unrelated baseline failures.

## File-level work

| Area | Planned change |
| --- | --- |
| `src/domain/clusters/viewState.ts` | Single focused-cluster state and reconciliation helpers |
| `src/domain/clusters/projection.ts` | Membership-based focused projection and authoritative visibility sets |
| `src/pages/WorkflowEditor.tsx` | Open/close focus operations, one frame, selection/interaction filtering, viewport fit/restore |
| `src/components/workflow/ExecutionIconButton.tsx` | Shared icon and labelled presentations |
| `src/components/workflow/ClusterExecutionControl.tsx` | Thin presentation-aware cluster adapter |
| `src/components/workflow/CompactClusterNode.tsx` | Hover/focus compact icon behavior and active-state visibility |
| `src/index.css` | Only narrowly needed hidden-host/frame interaction rules |
| Cluster unit/runtime tests | Focus, projection, identity, execution, persistence regressions |
| Browser fixture/spec | Four-cluster isolation and labelled-control end-to-end acceptance |

## Implementation order

1. Add focus-state and focused-projection tests.
2. Implement single focus and membership-authoritative projection.
3. Wire one frame, interaction filtering, MiniMap, Fit View, and viewport restoration.
4. Add the shared labelled presentation and cluster adapter prop.
5. Apply compact hover/focus and expanded labelled presentations.
6. Add runtime, execution, persistence, and browser regression coverage.
7. Run all focused checks, build validation, and visual acceptance in both themes.

## Acceptance criteria

- Opening a cluster displays only its canonical members, internal edges, and one expanded frame.
- Unrelated nodes and sibling cluster cards are invisible and cannot receive any editor interaction while focused.
- Closing restores the exact overview graph and viewport without changing canonical positions, membership, outputs, or runtimes.
- Compact clusters use hover/focus icon execution; expanded clusters use a centred labelled Execute/Stop control.
- Both presentations call the same cluster coordinator exactly once and never call Run All.
- Focus and projection data never enter persistence, history, exports, or execution payloads.
- All projection, runtime, interaction, accessibility, execution, persistence, and browser checks pass.