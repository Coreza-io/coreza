# Restore workflow-editor drag performance

## Goal

Make ordinary node dragging, compact-cluster dragging, and expanded-cluster frame dragging responsive without changing canonical workflow state, cluster membership, overlap visibility, inputs/outputs, execution behavior, history, persistence, or runtime ownership.

This is a frontend performance change. It requires no backend, API, database, migration, or persisted-document-format changes.

## Validated diagnosis

The uploaded document correctly identifies the highest-confidence hot path:

1. Every position update creates a new canonical `nodes` array.
2. `useCanonicalGraphSync(nodes, edges)` publishes that array in a layout effect.
3. `canonicalGraphStore.publish` compares only array references and notifies every subscriber.
4. Every mounted `BaseNode` and live `InputPanel` subscribes to that full snapshot.
5. Their display-name, upstream-node, incoming-edge, preferred-input, and selected-input calculations therefore rerun for unrelated position changes.
6. `projectClusterGraph` also runs whenever `nodes` changes and recreates hidden host copies, compact cards, maps, sets, handles, and rewritten boundary edges.
7. Compact and expanded-frame cluster movement updates many canonical member positions on every pointer event, magnifying both costs.

These are confirmed code paths, but their percentage of total drag time is not yet measured. The plan must begin with a reproducible baseline rather than claiming a timing or FPS improvement in advance.

## Corrections to the uploaded plan

Two proposed hot-path findings are not present in this checkout and must not become implementation work:

- `WorkflowEditor.onMouseMove` currently only stores `{clientX, clientY}`. It does not perform cluster geometry or insertion hit-testing.
- `src/domain/clusters/insertion.ts` and `resolveInsertionPosition` do not exist.

Therefore, do not add insertion drag guards, requestAnimationFrame scheduling, or insertion geometry infrastructure as part of this performance fix. Keep the current cheap pointer tracking unchanged and measure it only as a control.

The expanded-frame geometry concern is narrower than stated: the helper is called by projection and by the frame overlay. Share its index/bounds only if profiling shows a meaningful residual cost.

There is also an independent projection correctness mismatch: the current focused-cluster early return hides every outside node, while existing tests expect overlap-only hiding. Do not conceal that behavior change inside a performance cache. First establish the intended projection result with the existing correctness tests; any required correction must remain a small, separately testable projection change.

## Non-negotiable invariants

- Canonical nodes and edges remain the only mutable editor document. Projected cluster nodes remain render-only copies.
- Imperative readers (`getNodes`, `getEdges`, `getNodeById`) see current positions during every drag frame.
- Hidden collapsed members remain mounted because they own runtimes and registered editor actions.
- Node data, display names, values, outputs, pins, add/remove/rename, same-count replacements, and same-count reconnects propagate immediately.
- Edge endpoint and handle changes immediately update upstream/input selection.
- Cluster Execute remains a local sequence of normal node actions. Only explicit Run All remains batch execution.
- Position updates preserve structural sharing: unchanged canonical node objects are retained.
- Do not debounce the controlled React Flow position stream globally.
- Do not use node/edge counts as a semantic-change detector.
- Do not serialize full node data or output payloads on every drag event.
- Do not introduce stale geometry through a semantic API typed as a full React Flow `Node`.

## Phase 0 — Reproduce and instrument before editing

### Fixtures

Create deterministic browser fixtures or a development-only fixture generator for:

- small: approximately 20 nodes, no clusters;
- medium: approximately 100 nodes with realistic edges and several collapsed clusters;
- expanded: medium graph with one expanded cluster and nearby outside nodes/cards crossing its frame;
- large: approximately 300 nodes with realistic edges and collapsed members;
- panel-heavy: medium graph with multiple input/output panels expanded.

Use fixed IDs, positions, dimensions, edges, cluster memberships, viewport, and zoom so before/after traces are comparable. Do not rely on production user data or authenticated routes.

### Measurements

For ordinary node, compact-cluster, expanded-frame, and expanded-member drags:

- capture production-build browser traces for frame intervals, scripting, rendering, long tasks, and garbage collection;
- capture development React Profiler traces for `WorkflowEditor`, `NodeRouter`, `BaseNode`, `InputPanel`, compact cards, and frame overlays;
- temporarily count full canonical publications, semantic publications, `BaseNode`/`InputPanel` renders, upstream traversals, projection calls, frame-bound calls, and member copies per pointer update;
- record mounted node/action/listener counts before, during, and after collapse/drag cycles;
- use the same machine, browser, fixture, viewport, zoom, warmed state, drag path, and three repeated runs.

Remove temporary counters before delivery, or keep them only behind an existing development-only diagnostic boundary. Record the baseline and let it decide whether optional phases proceed.

## Phase 1 — Split full geometry publication from semantic publication

### 1.1 Define explicit snapshot contracts

Extend `canonicalGraphStore` with two channels:

- **Full canonical snapshot**: current React Flow nodes and edges, including positions, dimensions, selection, and dragging state. Existing imperative readers and geometry/projection consumers use this channel.
- **Semantic graph snapshot**: immutable semantic node/edge records containing only fields required by live node/input consumers. It must not pretend to be a current full `Node` because its geometry intentionally remains stable during geometry-only changes.

The semantic node contract should include at least node ID, type, order, and data. The semantic edge contract should include ID, source, target, source/target handles, and any edge semantic field actually consumed by input/topology logic. Confirm exact accesses before finalizing types.

Keep the full `publish` behavior current on every canonical update. Update the semantic snapshot and notify semantic listeners only when the semantic classifier reports a meaningful change.

### 1.2 Implement safe semantic classification

Add one tested comparison/classification utility with these rules:

Geometry-only changes do **not** notify semantic consumers:

- position and position-absolute values;
- measured/declared width and height;
- dragging, selected, z-index, and projection-only interaction/style/ARIA flags.

Semantic changes **do** notify immediately:

- node add/remove/reorder, ID, type, or data reference/content changes;
- display name, definition, values, field state, output, pinned output, workflow-session data, and any other consumed node data;
- edge add/remove/reorder, ID, source, target, source handle, target handle, type, or consumed edge data;
- same-length node replacement, rename, and same-length edge reconnect;
- complete workflow/session replacement, even when IDs and counts coincide.

Use immutable reference checks as the fast path, but first audit every node/edge writer. Current execution/output hooks sometimes mutate `data.output` or `data.pinnedOutput` before also calling the immutable updater. Preserve correctness by requiring the immutable update as the publication boundary and adding regression tests. Replace any writer that relies solely on in-place mutation; never deep-stringify output payloads per frame.

Store previous semantic records/signatures independently enough that an in-place mutation cannot retroactively corrupt the “before” comparison.

### 1.3 Preserve existing full access and startup behavior

- Keep `getNodes`, `getEdges`, and `getNodeById` on the latest full snapshot.
- Preserve the React Flow fallback before the first canonical publication.
- Keep the current full `subscribe/getSnapshot` API for genuine geometry consumers.
- Add required and optional semantic hooks parallel to the existing required/optional full hooks.
- Preserve `useSyncExternalStore` snapshot identity: unchanged semantic inputs return the exact prior semantic snapshot reference.
- Clear/rebuild both channels safely on workflow-session replacement; no cross-workflow record reuse.

### 1.4 Migrate only semantic consumers

Migrate `BaseNode` and live `InputPanel` to the semantic channel. Read-only/history panels continue using their supplied immutable execution snapshot and must not subscribe to the live editor.

Refactor upstream helpers to consume semantic records or a store-owned semantic topology index rather than full `Node` geometry. Preserve:

- deterministic upstream ordering and cycle safety;
- canonical traversal through collapsed clusters;
- preferred direct `done` input;
- stale selected-input repair;
- display-name de-duplication by semantic node order;
- execution-store output precedence, including falsy and null outputs;
- immediate response to field/reference/output/reconnect changes.

Do not broaden this into an execution-store rewrite unless profiling proves that store independently updates during idle dragging.

### 1.5 Phase 1 gate

For a pure position, dimensions, dragging, or selection change:

- full readers observe the latest state;
- semantic snapshot identity remains stable;
- semantic listener count is zero after initial publication;
- unrelated `BaseNode` and live `InputPanel` topology/input work does not run because of canonical publication;
- moved-node rendering and final position remain correct.

Stop and fix stale-data behavior before any projection optimization.

## Phase 2 — Reduce repeated upstream work

The existing `getAllUpstreamNodes` has a module-level one-entry cache keyed by full node/edge array references. A drag invalidates that cache, and a semantic change still makes every subscriber traverse its ancestry independently.

After Phase 1 is stable:

- build the semantic `nodeById` and incoming-edge index once per semantic snapshot;
- expose a pure cycle-safe ancestor lookup over that index;
- memoize per-target ancestor ID lists for the lifetime of that semantic snapshot;
- map IDs to current semantic records without geometry access;
- keep cache ownership editor/store scoped, not module-global, so simultaneous editors/tests cannot evict each other;
- discard the index and per-target results on any topology/session change.

Test cycles, diamonds, missing endpoints, deterministic order, collapsed-cluster canonical edges, same-count reconnects, and simultaneous independent stores.

## Phase 3 — Optimize cluster projection only if traces still justify it

Projection must still respond to position changes because compact-card placement, expanded-frame bounds, and overlap visibility are geometric. Do not simply remove `nodes` from its dependencies.

Split projection work into two explicit layers:

### 3.1 Structural projection plan

Cache only topology/view work whose inputs did not change:

- canonical node IDs and edge semantic topology;
- cluster IDs, membership, member order, titles/notes;
- expanded/collapsed/focused state;
- synthetic display-ID allocation and collision suffixes;
- collapsed owner lookup;
- internal-edge suppression, boundary endpoint/handle rewrites, and incoming/outgoing compact-handle lists.

Invalidate this plan on add/remove/rename/reconnect, edge-handle changes, membership/view changes, cluster metadata changes that affect a card, or workflow-session replacement. Preserve collision behavior exactly.

### 3.2 Geometry/materialization pass

On position/dimension changes, recompute only:

- compact-card positions;
- expanded frame bounds;
- positive-area overlap visibility;
- moved canonical/projected node positions;
- filtered edge visibility for endpoints crossing the overlap boundary.

Reuse unchanged canonical node objects. Reuse hidden runtime-host copies, compact-card data, rewritten boundary edges, maps, and sets only when all their actual inputs are unchanged. Run state, selection, callbacks, draggable state, note/title, member count, handles, and hide/show transitions must invalidate the corresponding object.

Use bounded editor-session caches keyed by stable IDs. Prune deleted/dissolved entries and clear all caches on workflow replacement. Never cache projected attributes back onto canonical nodes.

### 3.3 Shared geometry

Build one node index per full canonical snapshot and allow frame-bound calculations to consume it. Compute the focused frame once per editor render/projection result and reuse it for the overlay when safe. Replace the overlay’s repeated `nodes.some` member count with indexed membership.

Refresh bounds on member position, dimensions, membership, focus, or session changes. Outside nodes/cards moving across the frame must hide/show on the same drag frame; do not freeze overlap visibility until drop.

### 3.4 Projection gate

Re-run all projection correctness tests before judging performance. Verify focused overlap-only behavior, distant outside visibility, boundary-edge routing, compact ID collisions, selection/actionable sets, and canonical input immutability.

If Phase 1 already meets the measured target, omit Phase 3 rather than shipping speculative cache complexity.

## Phase 4 — Coalesce custom cluster movement only if still measured hot

Ordinary React Flow dragging stays unthrottled. Only the custom multi-member compact/expanded-frame path is eligible.

If traces still show excessive custom `setNodes` work:

- store the latest pointer delta and schedule at most one canonical multi-node position update per animation frame;
- derive every target from captured initial positions plus latest delta, never cumulative movement;
- update all moved IDs in one transaction while retaining every unchanged node reference;
- synchronously flush the final target on pointer-up before recording history;
- restore initial positions on Escape, pointer cancellation, or lost capture according to current behavior;
- cancel pending frames on unmount or workflow-session change;
- ensure compact React Flow position changes and custom member translation do not both apply the same delta;
- retain exactly one position-history entry per completed cluster move and none for a cancelled/no-op move.

Do not implement this phase without trace evidence after Phases 1–3.

## Tests

### Canonical store and semantic contracts

Add focused Jest tests proving:

- position, dimensions, selection, dragging, and projection-only flags update full reads but do not notify semantic listeners;
- data/values/output/pin/display-name/type changes notify once;
- add/remove/reorder/rename and same-count node replacement notify;
- add/remove/reorder/reconnect/handle/type changes notify;
- unchanged publications preserve both snapshot identities;
- workflow replacement cannot reuse old semantic records;
- required/optional hooks preserve provider and history behavior;
- audited immutable writers publish output and field changes despite prior local mutation.

### Upstream/input correctness

Extend canonical input tests for cycles, diamonds, missing nodes, same-count reconnects, `done` preference, stale selection repair, renamed nodes, collapsed canonical traversal, falsy/null output precedence, and two independent graph stores.

### Projection and cluster behavior

Run and extend projection/runtime-host tests for ordinary/member/compact/frame movement, overlap entry/exit, distant outside nodes, boundary edges, collapse/reopen/dissolve, synthetic ID collisions, run-state and selection updates, unchanged object reuse, and no canonical mutation.

### Browser correctness and performance

Use deterministic unauthenticated fixtures to:

- drag an ordinary node, expanded member, compact cluster, and expanded frame at multiple zoom levels;
- assert exact final positions and no cumulative drift;
- verify overlap hide/show while crossing boundaries;
- confirm zero runtime/action unmounts and uninterrupted outputs/listeners;
- verify selection, MiniMap, Fit View, collapse/reopen, dissolve, undo/redo, save-shaped serialization, and session-switch cancellation;
- collect counters proving zero semantic notifications and zero unrelated input/topology recalculations during geometry-only dragging.

Performance targets are gates, not promises: use the baseline machine to target p95 frame intervals at or below 20 ms on the representative medium production fixture and no repeated drag-attributable tasks above 50 ms. If the machine cannot meet the absolute target, report the measured improvement and remaining bottleneck without claiming 60 FPS.

## Delivery order

1. Record baseline traces and counters on the current checkout.
2. Implement the full/semantic store split and tests.
3. Migrate `BaseNode` and live `InputPanel`; remeasure.
4. Add store-scoped topology indexing; remeasure.
5. If still needed, split structural and geometric projection; remeasure.
6. If still needed, coalesce only custom multi-member movement; remeasure.
7. Run focused Jest suites, targeted Playwright fixtures, configured TypeScript check, lint for changed files, node validation, production build, and `git diff --check`.
8. Remove temporary instrumentation and publish a before/after report with commit, fixture sizes, browser, machine, build mode, traces, medians/p95, and limitations.

## Acceptance criteria

- Full canonical positions remain current throughout a drag.
- Pure geometry updates produce zero semantic graph notifications.
- Unrelated nodes and panels no longer redo canonical topology/input work during dragging.
- Same-count edits, reconnects, fields, outputs, pins, and renames still update immediately.
- Ordinary and cluster drags finish at the exact pointer-derived position with one correct history transaction.
- Overlap-only visibility and boundary edges update during movement.
- Hidden members remain mounted with runtimes and editor actions intact.
- Collapse, reopen, dissolve, Execute, rename, undo/redo, save/export-shaped serialization, and workflow switching retain current behavior.
- Every shipped optimization has a measured before/after benefit; optional cache/scheduling phases are omitted if earlier phases meet the target.
