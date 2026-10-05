# Hide only workflow objects overlapping an expanded cluster

## Goal

Expanding a cluster must keep the surrounding workflow visible. Temporarily hide only unrelated ordinary nodes or collapsed sibling cluster cards whose rendered rectangles overlap the expanded frame. Restore them as soon as the overlap ends or the cluster closes.

Keep the already-approved execution UI and behavior unchanged:

- compact cluster: hover/focus Play control;
- expanded cluster: labelled Execute/Stop control;
- both call the same existing cluster coordinator;
- only explicit Run All performs batch execution.

This plan supersedes the earlier full-canvas isolation plan.

## Validated diagnosis and branch gate

The requested correction is frontend display projection, not cluster membership, backend execution, persistence, or workflow layout.

The uploaded document describes a newer main branch that already has single-cluster focus, all-background filtering, and a labelled expanded control. This checkout is behind that baseline:

- its projection does **not** yet contain a `focusedMemberIds` isolation early return;
- it still supports multiple independently expanded cluster booleans rather than one focused cluster;
- compact hover/focus Play is present;
- the shared execution component supports labelled presentation, but `ClusterExecutionControl` and the expanded frame do not yet select it.

Therefore implementation must start on, or first integrate through the normal repository process, the branch containing the current focus and execution-control work. Do not reproduce the obsolete all-background isolation in this older checkout merely to remove it afterward. Once on the intended baseline, make only the overlap correction below. If implementation must target this checkout directly, first land the separately approved single-focus and labelled-control prerequisite unchanged, then apply this plan; those prerequisite changes are not to be redesigned here.

## Visibility contract

| Display object while a cluster is expanded | Result |
| --- | --- |
| Expanded cluster member | Always visible, including inside its frame |
| Ordinary outside node with no frame overlap | Visible and fully interactive |
| Ordinary outside node with partial or full frame overlap | Temporarily invisible and non-interactive |
| Collapsed sibling card with no frame overlap | Visible with normal expand/execute controls |
| Collapsed sibling card with partial or full frame overlap | Temporarily invisible and non-interactive |
| Canonical member of a collapsed sibling | Remains hidden by normal collapse projection |
| Projected edge with two visible endpoints | Visible |
| Projected edge with either temporarily hidden endpoint | Hidden |

Use any **positive-area** rectangle intersection. Exact edge or corner touching is not overlap. Hide the entire object; do not clip, mask, relocate, resize, or auto-layout it. An edge merely crossing the frame remains visible when both projected endpoints remain visible.

## Implementation plan

### 1. Lock the baseline behavior with focused tests

Before changing projection, add tests that distinguish the desired behavior from both the old “show everything” state and the rejected “hide all background” state:

- expanded members remain visible;
- non-overlapping ordinary nodes and sibling compact cards remain visible;
- partially and fully overlapping outsiders become hidden;
- exact edge/corner touching and a positive gap remain visible;
- edges remain only when both projected endpoints are visible;
- compact cluster mapping, collision-safe display IDs, projected handle IDs, and canonical-edge mapping remain intact;
- moving either the frame or an outside object recomputes visibility from fresh canonical/projection data;
- close/dissolve removes temporary occlusion without retained flags.

Replace any newer-main tests asserting “all non-members are hidden” rather than adding contradictory expectations. Preserve existing collapsed-runtime-host and first-painted-frame regression tests.

### 2. Centralize flow-coordinate rectangle geometry

Add small pure geometry helpers beside cluster projection so the frame overlay and occlusion pass use one source of truth.

Define a flow-coordinate rectangle type and helpers for:

- `getExpandedClusterFrameRect(cluster, canonicalNodes)`;
- `getProjectedNodeRect(node)`;
- `hasPositiveAreaIntersection(a, b)`.

Frame calculation must:

- use only valid canonical members of the expanded cluster;
- deduplicate member IDs and ignore stale/missing IDs;
- use canonical flow positions plus measured width/height when available;
- retain existing node dimension fallbacks where measurements are unavailable;
- retain frame constants: 24 px body padding, 42 px header allowance, and 52 px footer allowance;
- return no rectangle for a missing/empty cluster;
- remain independent of viewport pan/zoom.

Projected-object calculation must:

- use each visible canonical node’s flow position and measured/current/fallback dimensions;
- use the projected compact card’s position and fixed `COMPACT_CLUSTER_WIDTH`/`COMPACT_CLUSTER_HEIGHT`;
- use absolute flow coordinates if parent-relative nodes are introduced; the current checkout has no parent-relative node usage, so do not add speculative hierarchy code unless the implementation branch contains it.

Intersection must use strict comparisons on both axes:

```ts
a.x < b.x + b.width &&
a.x + a.width > b.x &&
a.y < b.y + b.height &&
a.y + a.height > b.y
```

Unit-test partial overlap, containment, identical rectangles, edge touch, corner touch, a positive gap, and zero-sized rectangles.

### 3. Preserve normal cluster projection, then apply occlusion

In `projectClusterGraph`, remove the newer branch’s focus-only early return that hides every non-member. Always build the established normal projection first:

1. expanded cluster members render as canonical nodes;
2. collapsed sibling members become invisible mounted runtime hosts;
3. collapsed siblings receive collision-safe synthetic cards;
4. boundary edges are rewritten to synthetic card handles;
5. display-node/cluster and display-edge/canonical mappings are retained.

After normal projection is complete, apply one overlap pass for the currently expanded/focused cluster:

- compute the frame rectangle once from canonical members;
- build an exemption set containing all valid members of the expanded cluster;
- begin with the IDs already hidden by collapsed-cluster projection;
- inspect only currently visible projected canonical nodes and synthetic compact cards;
- never treat the expanded cluster’s members as occlusion candidates, even though they lie inside the frame;
- when a candidate positively intersects the frame, decorate only its projected copy with the established hidden-host visibility and interaction flags;
- combine normal collapsed-member IDs and newly occluded projected IDs into one display-hidden set;
- derive visible projected IDs/nodes from that combined set;
- filter the already-projected edge list when either projected endpoint is in the combined hidden set.

Do not rerun edge rewriting after occlusion. This preserves synthetic endpoint IDs, boundary handles, callbacks, and `displayEdgeToCanonicalEdge`.

### 4. Make hidden decoration explicit and safe

Extract or reuse one render-only helper for projected hidden objects:

- retain ID, type, data object, position, dimensions, and React key identity;
- append the established runtime-host class without discarding existing classes;
- set `visibility: hidden`, `pointerEvents: none`, no transition, and no animation;
- set `aria-hidden`;
- disable drag, select, connect, delete, and focus;
- clear projected selection only on the hidden copy.

Canonical ordinary nodes must remain mounted so listeners, output stores, editor actions, Loop/Consolidator state, and component-owned runtime state survive. Synthetic cards own no runtime, but use the same decoration for a uniform projection contract and stable display IDs.

Rename `hiddenRuntimeHostIds` to a semantically accurate `hiddenDisplayNodeIds` if the newer integration can migrate all consumers atomically. Otherwise preserve the existing field for compatibility and document that it now includes both canonical runtime hosts and occluded synthetic display IDs. Do not let the name cause consumers to assume every ID is canonical.

Every projection run starts from canonical nodes and freshly generated synthetic cards. Never feed decorated projection copies back into projection, canonical state, undo history, save/export, or execution.

### 5. Render the expanded frame from the same rectangle

In `WorkflowEditor`, replace duplicated min/max frame arithmetic with `getExpandedClusterFrameRect`.

- transform the shared flow rectangle to screen coordinates only when styling the overlay (`x/y/width/height` through the current viewport);
- do not compute occlusion from screen coordinates;
- preserve the existing header/footer/body pointer behavior and member-only cluster drag;
- render no frame when the focused cluster has no valid members;
- ensure member movement, measured dimension changes, membership changes, open/close, and sibling-card movement trigger projection/frame recalculation from the same inputs;
- pan/zoom must move/scale the overlay without changing which flow rectangles overlap.

Using one rectangle for both the overlay and occlusion prevents mismatch, shrink loops, and flicker. Never derive frame bounds from the already filtered display graph.

### 6. Replace focus-wide assumptions with actual visibility checks

On the newer implementation branch, audit every `focusedClusterId`/focus-mode guard in `WorkflowEditor`. Focus identifies which frame is expanded; it must no longer mean all outside objects are inaccessible.

Use the projection’s combined hidden set/visible set for display interactions:

- node position/select/remove changes;
- rectangle and click selection;
- context-menu targeting;
- keyboard Delete, Copy, Group, and Dissolve targets;
- connection start/end and edge removal;
- compact-card drag and expand actions;
- paste/drop targets where existing focus-wide gating exists;
- MiniMap rendering and explicit Fit View.

Rules:

- visible outside nodes and sibling compact cards retain their normal interactions;
- hidden projected IDs cannot be selected, moved, connected, opened, executed, copied, grouped, dissolved, or deleted through display events;
- selected objects that become occluded are excluded from subsequent target resolution, without clearing every still-visible outside selection;
- dimension changes for mounted hidden canonical nodes remain accepted when needed for future geometry; do not discard useful measurements merely because interaction is disabled;
- canonical/display-ID translation remains at interaction boundaries;
- independent read-only, connection-drag, and execution-lock checks remain authoritative;
- expanded-header dragging remains restricted to that cluster’s canonical member IDs.

Search all focus-only guards before completion and classify each as navigation-only (retain) or visibility-related (replace with actual hidden/visible checks).

### 7. Keep viewport, MiniMap, and Fit View behavior narrow

- MiniMap omits normal collapsed runtime hosts and newly occluded canonical/card IDs, but includes every non-overlapping outside object.
- Explicit Fit View uses the corrected visible projected set.
- If opening a cluster currently performs a one-time fit to its members, preserve that policy by passing member nodes specifically to that one action; do not change it to fit the entire surrounding workflow.
- Preserve existing overview viewport capture/restore and single-focus lifecycle from the newer baseline.
- Do not introduce a new automatic camera mode, repeated refitting, object relocation, or layout animation.

### 8. Leave execution controls and runtime semantics unchanged

No changes are required to the working control presentation or execution path on the intended baseline.

- expanded labelled Execute/Stop remains centred and unchanged;
- compact hover/focus Play remains unchanged;
- both retain the same callbacks, status, lock, cancellation, pointer isolation, keyboard behavior, and duplicate-activation guard;
- `useClusterExecution` continues receiving complete canonical nodes, edges, and clusters—not projected/visible collections;
- external nodes may provide existing outputs/references but are never executed because of cluster execution;
- BacktestInit initializes once, OnBar advances one manual step, and only Run All performs historical replay.

Add regression assertions that visibility changes do not alter execution request counts, member order/outcomes, output publication, active cancellation, or button presentation. Do not modify execution controls merely to satisfy this visibility fix.

### 9. Persistence and architecture safeguards

- Projection nodes remain render-only copies; all mutations begin from canonical editor state.
- No occlusion, focus, synthetic ID, hidden class/style, filtered edge, or screen-space rectangle enters workflow save, export, history, execution payloads, or cluster metadata.
- Undo/redo affects only real document edits, then recomputes occlusion.
- Save/reload/export while objects are occluded produces the same canonical document as when they are visible, apart from genuine edits.
- No backend API, worker, queue, database migration, schema, output contract, cluster membership change, or automatic layout change is needed.

## Targeted test matrix

Create a browser fixture matching the reported shape:

- one expanded cluster;
- an external upstream Store outside the frame;
- two collapsed sibling cards outside the frame;
- one collapsed sibling card partially or fully overlapping the frame;
- one ordinary outside node overlapping the frame;
- internal and external projected edges;
- member coordinates that make geometric overlap unambiguous.

Verify:

1. Expanded members, the frame, and all non-overlapping surrounding workflow objects remain visible.
2. Partial and full overlap hide the entire unrelated node/card in the first stable painted state.
3. Exact edge/corner touch and a small positive gap stay visible.
4. A member remains visible even though its rectangle intersects the frame by design.
5. A non-overlapping sibling card can still be selected, dragged, expanded, and executed.
6. Moving the expanded frame away restores previously hidden objects immediately from fresh projection.
7. Moving an outsider into and out of overlap toggles only its projected visibility and interactions.
8. Closing or dissolving the expanded cluster clears occlusion and restores ordinary collapse behavior.
9. Edges with visible endpoints remain, edges to occluded endpoints disappear, and an edge crossing the frame with visible endpoints remains.
10. Pan/zoom does not change overlap classification; measured dimension changes keep overlay and occlusion aligned.
11. Hidden canonical nodes stay mounted with one runtime/action registration and retain output/listener/Loop/Consolidator state.
12. Selection, drag, keyboard, context menu, copy/group/delete, connections, MiniMap, and Fit View obey actual visibility.
13. Save, export, reload, undo, and redo contain no temporary projection data.
14. Expanded Execute and compact Play remain visually and behaviorally unchanged and invoke the existing coordinator once.
15. Light/dark themes and reduced motion show no hide/show transition glitch or stale interactive surface.

Run focused geometry/projection/selection/runtime Jest tests, the targeted Playwright fixture, changed-file lint, TypeScript checks, and `npm run build`. Record exact commands, screenshots, mount/request counts, and outcomes; separate unrelated baseline failures.

## File-level scope

| Area | Change |
| --- | --- |
| `src/domain/clusters/projection.ts` | Shared frame/node rectangles, strict overlap helper, normal projection plus occlusion pass, combined hidden/visible set, endpoint filtering |
| `src/pages/WorkflowEditor.tsx` | Shared frame rectangle and actual-visibility interaction consumers |
| Projection/selection/runtime tests | Selective overlap, identity, restoration, interaction, and persistence regressions |
| Browser fixture/spec | Screenshot-shaped overlap reproduction and dynamic movement checks |

Keep `viewState`, execution controls/coordinator, backend, schema, persistence formats, and canonical cluster commands unchanged unless the selected implementation branch lacks the already-approved prerequisites; in that case integrate those prerequisites separately before this correction.

## Implementation order

1. Confirm the target branch contains single-cluster focus and the approved compact/expanded controls.
2. Add strict rectangle and selective-overlap regression tests.
3. Centralize frame/projected-node geometry.
4. Restore normal projection and add the final occlusion/edge-filter pass.
5. Switch editor rendering and interactions from focus-wide assumptions to actual hidden/visible sets.
6. Add dynamic movement, runtime identity, persistence, and browser coverage.
7. Run focused tests, lint/type checks, build, and visual acceptance.

## Acceptance criteria

- Opening a cluster keeps every non-overlapping surrounding workflow object visible and usable.
- Only unrelated ordinary nodes and collapsed sibling cards with positive-area frame overlap are temporarily hidden and non-interactive.
- Expanded members are never hidden by their own frame.
- Hidden objects reappear when overlap ends or the frame closes, with state and identity intact.
- Edge visibility follows projected endpoint visibility without changing canonical edges.
- The actual overlay rectangle and occlusion calculation remain aligned through movement, measurement, pan, and zoom.
- No temporary visibility data leaks into canonical state, history, persistence, or execution.
- Existing expanded Execute, compact Play, and cluster execution behavior remain unchanged.