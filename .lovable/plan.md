# Fix the remaining workflow-editor drag lag

## Outcome

Make ordinary node dragging, compact-cluster dragging, expanded-frame dragging, and connection dragging responsive while preserving node placement, custom edge routing, cluster visibility, runtime ownership, inputs/outputs, undo/redo, persistence, and execution behavior.

This remains frontend-only. No backend, API, database, migration, or saved-workflow schema changes are required.

## Verified current state

Implementation audit (checkout `05ad804`, 7 Oct 2026): **not implemented**, except the prerequisite.

| Plan item | Status | Evidence |
| --- | --- | --- |
| Semantic graph prerequisite (step 2) | Done (merged via `7a2e3cb`) | `subscribeSemantic`, `useSemanticGraphSnapshot`, `useOptionalSemanticGraphSnapshot`; `BaseNode` uses the semantic hook |
| Browser baseline (step 1) | Not done | No drag/performance browser fixture exists |
| Narrow edge subscriptions (step 3) | Not done | `EdgeManager` still calls `useNodes()` at ~566, ~831, ~930; routing still uses `nodes.find` at ~63, ~275–276; no `useStore` selector |
| Insertion guard during drags (step 4) | Not done | `onMouseMove` (~1603–1632) still calls `screenToFlowPosition` and `resolveInsertionPosition` on every move with no drag check; the guard exists only in `createNode` (~1645) |
| Drag lifecycle refs | Partial | `activeNodeDragRef` and `clusterMoveRef` exist; no synchronous connection-drag ref, no `onSelectionDragStart/Stop` handling |
| Projection identity reuse (step 5) | Not done | `projection.ts` has no reconciliation; no previous-projection ref in the editor |
| Tests (step 6) | Not done | No edge-selector, insertion-guard, or projection-identity tests |

Other confirmed facts still hold:

- `EdgeManager`'s three whole-node subscriptions re-render each edge for unrelated node changes.
- `projectClusterGraph` reruns on node movement and recreates hidden hosts, compact cards, boundary edges, maps, and sets.
- React Flow exposes `useStore` and `nodeLookup`; its edge wrapper already supplies handle coordinates.

Therefore, implementation proceeds directly with steps 1 and 3–7. Step 2 is retained only as a regression gate.

## Architecture and correctness constraints

- Canonical editor nodes/edges remain the only mutable document; projected cluster nodes remain render-only copies.
- Full canonical reads retain current positions during every drag frame.
- Geometry-only changes must not notify semantic graph consumers.
- Hidden collapsed members remain mounted because they own runtimes and editor action registrations.
- Cluster Execute remains editor-local manual-node execution; only Run All is batch.
- Existing forward/backward/vertical/self-loop routing, handle offsets, compact synthetic endpoints, themes, controls, labels, markers, and missing-node fallbacks remain unchanged.
- Expanded-frame overlap visibility must update during movement; distant outside nodes remain visible.
- Do not debounce ordinary React Flow movement, remove edge effects, add virtualization, or redesign projection architecture without profiling evidence.

## 1. Establish a browser baseline

Before changing source, create deterministic unauthenticated React Flow fixtures that mount the real `EdgeManager`, cluster projection, nodes, and panels:

- no clusters with realistic edge density;
- collapsed clusters plus an unrelated standalone node;
- expanded cluster with outside nodes/cards crossing its frame;
- panel-heavy graph;
- compact and expanded-frame multi-member movement.

Use small/medium/large sizes representative of roughly 20/100/300 nodes. Fix IDs, positions, dimensions, edges, memberships, viewport, zoom, and drag path.

Record three warmed runs in a production build and use development profiling separately. Capture frame intervals, long tasks, scripting/layout/paint, React commits, edge renders/path calculations, semantic/full publications, projection calls/allocations, insertion-resolution calls, and mount/unmount/action-listener counts. These establish causality; no FPS claim is made before this trace.

## 2. Semantic graph prerequisite (already merged — verify only)

This is now in the checkout. Do not reimplement it; run its tests as regression gates. The behavior it must keep:

- add full and semantic snapshots/listeners to the canonical graph store;
- preserve current full snapshots for imperative and geometry consumers;
- publish semantic snapshots only for node/edge identity, type, data, topology, handle, order, or workflow-session changes;
- preserve detection of top-level in-place data mutations by storing independent signatures/copies;
- keep semantic records geometry-free;
- own `nodeById`, incoming-edge indexes, and memoized cycle-safe ancestor results per store/snapshot, not in a module-global cache;
- pass `workflowSessionId` into canonical synchronization so identical records from another workflow cannot reuse stale semantic state;
- migrate `BaseNode` and live `InputPanel` to required/optional semantic hooks;
- keep history/read-only input panels isolated from the live editor;
- preserve display-name ordering, canonical collapsed-cluster traversal, preferred `done` input, stale selection repair, and falsy/null execution-output precedence.

Bring over and run its focused store/input tests and publication benchmark. Acceptance for this prerequisite is zero additional semantic notifications across geometry-only updates while full readers see every position, plus immediate updates for data/output/pin/rename/add/remove/reorder/reconnect/handle/session changes.

Do not optimize semantic signature scanning in this task unless the browser trace still identifies it as material after the remaining fixes.

## 3. Narrow custom edge subscriptions

### 3.1 Add typed scalar selectors

In `EdgeManager`, replace all three `useNodes()` calls with small `useStore` selectors:

- `PlugEdge`: source visual category/theme plus source/target routing geometry;
- `InteractiveEdge`: source/target routing geometry only;
- `PlugConnectionLine`: active source visual category/theme only.

Read endpoints by ID from `state.nodeLookup` in constant time. Return immutable scalar slices, not the node array, lookup map, internal nodes, or mutable user-node references. Compare fields explicitly (or with shallow equality over primitives):

- endpoint existence;
- user-node top-left `position.x/y`, preserving current route semantics;
- measured width/height with current declared-size/default fallbacks;
- source visual category or resolved edge color.

React Flow already passes handle coordinates/positions as edge props; keep those authoritative for path endpoints. The selector only supplies the extra node bounds needed for routing around backward connections and source theme.

Keep hooks unconditional for self-loop and missing-node cases. A source/target move, resize, deletion/replacement, or source-definition/theme change must update the slice. Unrelated node movement/selection must leave it referentially/equivalently unchanged.

### 3.2 Keep routing behavior intact

Change `calculateSmartPath` to accept the two endpoint-bound records directly, or pass a two-record adapter if that creates the safer smaller diff. Remove all full-array `.find` calls.

Preserve exactly:

- current measured/declared/default dimensions;
- current top-left and handle-coordinate fallbacks;
- all forward, backward, vertical, orthogonal, and self-loop paths;
- plug offsets, markers, labels, controls, hover behavior, colors, and light/dark behavior;
- compact synthetic cluster endpoints from the rendered React Flow store.

`React.memo` may be added only after selector narrowing and only where render-count evidence shows parent-prop churn remains. Memoization is not a substitute for removing the broad subscription.

## 4. Skip advisory insertion geometry during active drags

Keep updating `mousePosRef` first. Preserve the current control-element and member-selection precedence. Before calling `screenToFlowPosition` or `resolveInsertionPosition`, return when any active canvas operation exists:

- ordinary or selected-node drag;
- compact or expanded-frame cluster move;
- connection drag.

Use synchronous refs for drag state so the first event after drag start cannot race React state. Extend the existing lifecycle rather than introducing a second global drag system:

- node drag start/stop, including multi-selection;
- expanded-frame pointer up, Escape, pointer cancel, and lost capture;
- connection start/end/cancel;
- workflow-session change and component unmount.

Clear `activeNodeDragRef`, cluster-move state, and connection-drag ref on every termination path. Keep React state for rendering where already needed.

This guard affects only advisory pointer tracking. Palette click/drop must continue to call `resolveInsertionPosition` against the latest canonical nodes, clusters, focus, zoom, and workflow session before committing. After stop/cancel, pointer insertion must resume immediately with existing sticky inside-cluster/member-selection/outside precedence. Do not throttle canonical drag positions.

## 5. Conservatively reconcile equivalent projection outputs

Keep `projectClusterGraph` geometry and visibility calculations correct on every relevant node movement. Add a pure reconciliation layer that compares a freshly calculated projection with the **last committed** projection and canonical inputs, returning prior references only where output is equivalent.

Store the previous committed `{workflowSessionId, canonicalNodes, canonicalEdges, projection}` in the editor and update it in a layout effect after commit. Do not mutate a cache during render; ignore/clear prior results on session replacement. This avoids stale results under interrupted React renders.

### Reuse rules

- **Visible canonical nodes:** keep canonical references unchanged.
- **Collapsed/occluded runtime hosts:** reuse only when the corresponding canonical node reference is unchanged and all projection decorations/visibility flags are equivalent. Recreate the moved or otherwise changed host. Never write flags into canonical state.
- **Compact cards:** separate stable data from geometry. Reuse data when cluster ID/title/note/member count, ordered handles, meaningful run-state fields, and callbacks are equivalent. Update only card position, selection, draggable state, or other changed fields. Treat fresh idle run-state objects as equal by fields, not object identity.
- **Boundary edges:** reuse only when the canonical edge reference and projected source/target/handle/data result are unchanged. Recreate on reconnect, handle/data/style/callback changes, cluster mapping changes, or canonical edge replacement.
- **Arrays/maps/sets:** reuse prior nodes/edges arrays and mapping/visibility sets when order and contents/references are unchanged. Preserve map/set insertion order and synthetic-ID collision allocation.

Use ID-indexed comparisons and structural sharing; do not deep-serialize node output payloads or scan the entire graph repeatedly for each projected object. Prune by using only the latest committed result; no unbounded per-ID history.

Genuine changes must still propagate immediately: member/compact movement, dimensions, membership, title/note/count, selection, draggable state, run/cancel state, callbacks, reconnects, handles, focus/collapse state, overlap entry/exit, and session replacement.

Start with downstream identity reuse. Only split projection into structural/geometry compilers or share frame indexes if re-profiling shows projector computation—not reconciliation—remains material.

## 6. Required tests

### Edge selectors and routing

- selector result stays equal and integration render/path counter stays unchanged when an unrelated node moves or changes selection;
- source/target movement and measured-size changes update routing;
- source theme changes update edge color;
- deletion/missing endpoints retain current fallback;
- forward/backward/vertical routes, self-loops, Loop edges, compact synthetic endpoints, and connection previews match existing path output;
- controls, labels, markers, hover actions, and light/dark colors remain correct;
- no whole-node subscription or N-node endpoint lookup remains in the three identified components.

Use a React Flow-mounted integration test, not only selector-unit equality.

### Insertion guard lifecycle

- spy/counter proves zero insertion resolutions during ordinary, multi-selection, compact, expanded-frame, and connection drags;
- insertion resumes after normal stop, Escape, pointer cancel, lost capture, connection cancel, workflow switch, and unmount/remount;
- click/drop revalidates exact current placement and preserves inside/member/outside/stale-session behavior;
- final drag positions remain exact at multiple zoom levels with no snap-back.

### Projection identity and correctness

- in a 300-node fixture, unrelated movement retains equivalent hidden-host, compact-card/data, boundary-edge, map, set, and unchanged array-entry identities;
- moved members/cards update only affected geometry;
- run state, callbacks, title/note, selection, membership, rename, reconnect, handle, and collision changes invalidate affected results;
- overlap entry/exit immediately updates hidden nodes/cards and edges;
- session replacement cannot reuse stale members, callbacks, or run state;
- prior returned projections and canonical inputs are never mutated;
- collapsed members remain mounted with one runtime/action registration.

Run existing semantic-store, canonical-input, cluster insertion, projection, runtime-host, rename, history, and cluster-execution regressions as well.

## 7. Reprofile and allow at most measured follow-ups

Re-run the identical browser fixtures after each main change. Report three-run median and p95, graph/edge sizes, browser, machine, viewport, zoom, build mode, and limitations.

Only if traces still show a clear bottleneck, choose the matching follow-up:

- projection scripting: share the per-snapshot node index/focused-frame bounds;
- custom multi-member pointer updates: coalesce only that custom path to one update per animation frame, derive from initial positions, flush before history, and cancel safely;
- paint/animation: suppress only decorative edge animation during active drag through one canvas-level drag state, restoring on every termination path;
- semantic publications: identify and fix the writer producing semantic changes; do not remove semantic correctness checks.

If targets are met, stop. Do not stack speculative optimizations.

## Verification and acceptance

Run focused Jest suites, the real React Flow browser fixtures, the configured TypeScript check, changed-file lint, node validation, production build, and `git diff --check`. Remove temporary instrumentation before delivery.

Acceptance requires:

- current full canonical positions throughout movement;
- zero geometry-only semantic notifications;
- no whole-node-array subscriptions or N-node endpoint scans in the three custom edge paths;
- stable unrelated edge path work and equivalent projection identities;
- zero insertion hit tests during active canvas operations;
- exact final positions and one history transaction per completed cluster move;
- correct overlap visibility, routes, themes, inputs/outputs, runtime/action ownership, insertion, rename, collapse/reopen/dissolve, Execute, undo/redo, save/reload/export-shaped state, and workflow switching;
- measured before/after improvement, targeting approximately 20 ms p95 frame intervals on the representative medium fixture and no repeated drag-attributable tasks over 50 ms, without claiming guaranteed FPS when hardware prevents the absolute target.
