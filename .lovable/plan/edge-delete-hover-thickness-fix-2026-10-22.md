# Edge deletion, thickness and stable hover controls — dev fix plan

Date: 2026-10-22
Repository: Coreza-io/coreza
Reviewed dev commit: b9f8cbe9ef4775f82351e4d9c1010b93007cb680
Status: implementation plan only; no application code changed.

## Requested result

- One deliberate delete click removes the intended connection completely.
- Connections look slightly thicker and remain easy to see at ordinary editor zoom.
- Hovering a connection consistently reveals its delete control.
- Leaving the connection does not immediately hide the control: the pointer can move onto it.
- Preserve canonical graph state, cluster semantics, undo/redo, distinct handles and editor performance.

## Evidence from current dev

### Edge interaction: confirmed weaknesses

In src/components/workflow/EdgeManager.tsx:

- PlugEdge uses an invisible interaction path with strokeWidth=3; InteractiveEdge uses strokeWidth=1.
- Both set local hovered=true on mouse enter and false immediately on mouse leave.
- Controls mount only while hovered. There is no leave timer or shared edge/toolbar hover ownership.
- Controls render inside a 60×30 SVG foreignObject; each button has a 12 px icon plus 10 px padding on each side. Overflow is visible, but the layout/hit area needs verification.
- Buttons directly invoke ctrl.onClick without stopping propagation. A parent selection/pan handler may interfere; this is a risk to reproduce, not a confirmed root cause.
- PlugEdge defaults to width 2; DefaultEdge supplies width 3 but props.style can override it; the PlugEdge self-loop branch explicitly supplies width 2. LoopEdge uses 3.
- calculateSmartPath uses arithmetic endpoint averages for forward Bezier toolbar positions rather than the label coordinates returned by getBezierPath. This is not a reliable general path-label anchor; use the existing path helper's coordinates.
- src/index.css places edges at z-index 2 and nodes at 100, with expanded nodes at 1000. A control rendered inside the SVG edge layer can be obscured by nodes. Do not globally raise every edge above nodes.

### Deletion: confirmed path, unresolved cause

In src/pages/WorkflowEditor.tsx:

- removeEdge filters canonicalEdgesRef.current by the requested edge ID, then calls commitEdgeCandidateRef.
- commitEdgeCandidate validates clusters, saves history and calls setEdges. It does not enforce logical edge uniqueness or skip no-op history entries.
- onConnect uses addEdge, which offers local duplicate protection, but load, restore, paste and document insertion are separate entry paths.
- onEdgesChange processes structural React Flow changes against canonical state; deletion should consistently resolve display IDs through displayEdgeToCanonicalEdge, as onReconnect already does.
- src/hooks/useWorkflowPersistence.ts restores every saved edge and its delete callback without exact-duplicate normalization.
- src/domain/clusters/projection.ts projects at most one edge per canonical edge, preserving the ID and recording display-to-canonical mapping. Multiple canonical edges can still visually overlap.
- reconcileProjection.ts reconciles by identity and list changes; no evidence yet proves it retains a deleted edge.

The older .lovable/plan/fix-duplicate-overlapping-edges-delete-twice-2026-10-07.md already proposed duplicate diagnostics and prevention. Its proposed workflowEdges helper is absent from the reviewed tree. Treat it as historical planning, not proof that duplicates caused this occurrence. This document supersedes that plan for these three issues. In particular, its direct Loop append description is stale: current handleAddNode uses insertNodesInDocument and restoreDocument.

The screenshots demonstrate thin connections but cannot establish whether a missed click, duplicate record, or display synchronization defect causes the repeated delete.

## Interaction design

1. Reveal the toolbar immediately on hover entry and cancel any pending hide.
2. Schedule hiding after a 150 ms leave grace period so the pointer can reach the toolbar.
3. Keep the 40 px interaction region independent of visible stroke width.
4. Render controls through React Flow's EdgeLabelRenderer and track toolbar hover/focus separately.
5. Choose visible stroke width for Coreza's canvas and zoom levels.
6. Resolve deletion to a canonical connection before committing it.

## Implementation sequence

### 1. Reproduce and distinguish the delete failure

Use a deterministic two-node workflow and the affected saved workflow if available. Exercise normal, self-loop and cluster-boundary edges.

Add temporary development-only instrumentation at the toolbar click, canonical delete command and projection output. Record only edge identity/endpoint metadata and counts:

- displayed ID, resolved canonical ID;
- source, sourceHandle, target, targetHandle;
- exact matching canonical IDs before/after;
- whether the callback fires on the first click;
- mutation guard result;
- whether canonical deletion succeeds and whether displayedEdges still contains the ID after the next commit.

Do not log node outputs or credentials.

Interpretation:

| Observation | Fix direction |
| --- | --- |
| First click never reaches the callback | Hover/hit region/event handling |
| First click removes one of multiple exact connections | Canonical duplicate prevention and legacy repair |
| Requested ID is not canonical | Display-to-canonical resolution |
| Canonical edge disappears but display retains it | Projection/reconciliation or a stale writer |
| Mutation guard rejects deletion | Respect guard; prevent/disable unavailable affordance |

Do not assume duplicates from the symptom alone or delete all edges sharing only source and target.

### 2. Make hover controls reliable

Introduce a small shared hover hook used by PlugEdge and InteractiveEdge:

- Enter edge or toolbar: clear pending hide and show immediately.
- Leave either area: schedule hiding after 150 ms.
- Keep visible while either edge or toolbar is hovered, or toolbar has keyboard focus.
- Re-enter before expiry: cancel hide.
- Clear timers on unmount, edge identity/session change, successful deletion and when editability is revoked.
- Read-only/history views must not reveal mutation controls. If callbacks exist while a live mutation guard rejects editing, hide/disable controls consistently; guard at click time remains authoritative.

Use a transparent 40 px interaction stroke following exactly the visible path, with fill=none and pointerEvents=stroke. Keep visible stroke separate. Test crossings and nearby parallel edges; only the intended edge's toolbar should become active. Avoid an extra overlapping default interaction path if adopting BaseEdge.

Move the shared controls to React Flow EdgeLabelRenderer with pointerEvents=all and nodrag/nopan classes. Wire toolbar hover/focus explicitly because portaled labels are outside the SVG group's DOM hover region. Provide a normal button with aria-label="Delete connection", predictable hit area and stable test selector.

Stop propagation on toolbar pointer-down and click to prevent canvas pan/selection handlers consuming the action; retain keyboard activation. Invoke the existing canonical delete command exactly once. Do not use pointer-down deletion, double-click handlers, or retrying the delete automatically.

Use a narrowly scoped active-toolbar layer; preserve node/frame ordering and verify clipping in expanded clusters. Do not change the whole edges layer z-index to solve one toolbar.

Use getBezierPath's returned label coordinates for Bezier routes; preserve the explicit segment anchor for orthogonal routes/self-loops. A toolbar should be anchored to the connection, not hover-position-dependent or jumping during pointer movement.

### 3. Make lines slightly thicker, consistently

Use one shared default visible width of 3 graph units for regular, self-loop, loop and connection-preview paths. This is a Coreza design starting point. Remove conflicting hardcoded width-2 defaults where they override the shared policy.

Preserve intentional execution status colors, dashes and width overrides. Ensure agent-active width does not accidentally make an otherwise wider edge thinner. Keep saved graph data free of hover styling.

Inspect at 50%, 75%, 100% and 150% zoom in light and dark themes. If width 3 is too thin when zoomed out, use a shared bounded zoom compensation at the canvas/CSS level. Do not add a broad React Flow store subscription to every edge, and do not introduce a graph-wide rerender on each hover. Start with fixed 3 and add compensation only if visual QA requires it.

### 4. Fix canonical deletion based on step 1

Centralize delete intent in the editor:

1. Resolve display ID through the current displayEdgeToCanonicalEdge map.
2. Read the latest canonical graph and current mutation guard.
3. Return without history changes if the edge no longer exists.
4. Build and validate the candidate once.
5. Commit one history entry and one canonical deletion.
6. Reproject and confirm the edge is gone.

Route toolbar deletion and structural React Flow removal changes through consistent identity handling. Avoid using React Flow's projected getEdges/setEdges as document authority. Keep all existing cluster validation and explicit dissolve behavior.

If duplicate canonical connections are confirmed, add a small pure helper in src/domain/workflowEdges.ts:

- Compare the canonical tuple [source, sourceHandle ?? null, target, targetHandle ?? null].
- Use an unambiguous tuple encoding; do not use delimiter concatenation that can collide.
- Preserve different handles, reverse-direction connections, loop semantics and any independently meaningful edge kind/metadata. Audit edge semantics before deciding that endpoint equality alone authorizes repair.
- Deduplicate only canonical connections, never projected cluster endpoints.
- For safe exact duplicates, preserve the first identity and original order; return unchanged references when possible.
- Enforce the invariant at structural commit and all graph-entry boundaries actually found: connect/reconnect, insertion, import, load, version restore, paste and undo/redo restoration.
- Do not silently discard conflicting metadata. Surface a repair requirement or retain the records until semantics are resolved.
- Loading must not silently write the repaired graph to the server. Explicit save persists any approved in-memory normalization, with dirty/saved baseline behavior documented.
- If no duplicates exist in reproduction, omit speculative normalization changes and fix the observed cause.

If projection retention is confirmed, add a regression that fails on that exact stale path and patch only the responsible reconciliation/writer boundary. Do not mask it with a second delete or forced canvas remount.

### 5. Keep scope small

Expected files:

| File | Planned responsibility |
| --- | --- |
| src/components/workflow/EdgeManager.tsx | Interaction path, shared toolbar, path anchor, widths |
| src/hooks/useEdgeToolbarHover.ts (suggested) | Local hover/focus timer lifecycle |
| src/pages/WorkflowEditor.tsx | Canonical delete intent and no-op handling |
| src/index.css | Scoped toolbar appearance/layering if needed |
| src/domain/workflowEdges.ts (conditional) | Proven duplicate invariant |
| src/hooks/useWorkflowPersistence.ts and document entry boundaries (conditional) | Safe legacy duplicate handling |
| Focused tests | Timer behavior, deletion, cluster projection and browser interaction |

Do not change execution routing, broker behavior, cluster hierarchy, geometry beyond toolbar anchoring, backend persistence contracts or database schema for this issue. Follow root AGENTS.md: canonical mutations only, reconciled projections, and narrow endpoint subscriptions.

## Verification

Add focused regression coverage appropriate to the eventual fix:

- Fake timers: immediate show; visible at 149 ms after leave; hides at 150 ms; re-entry cancels; toolbar hover/focus retains; unmount clears pending work.
- One actual trash click deletes one intended canonical connection; no second click, reappearance, duplicate history entry or delayed write restores it.
- If duplicates are confirmed: repeated creation and legacy exact duplicates; distinguish null/undefined handles; preserve separate handles and meaningful metadata.
- Browser tests move the real pointer from line to toolbar across the gap and click, rather than invoking a handler directly.
- Cover both PlugEdge and InteractiveEdge paths, normal forward/backward edges, self-loop/Loop, expanded/collapsed clusters and cluster boundaries.
- Verify adjacent/crossing edges delete only the chosen connection.
- Undo restores the intended connection once; redo removes it once. Save/reload does not resurrect the deleted connection.
- Confirm no mutation controls in read-only execution history, and guard changes during a pending hover timer cannot enable editing.
- Check both themes and zoom levels, execution animations, keyboard delete/focus, panning and dense-graph dragging.
- Run the repository's targeted Jest configuration for new tests plus cluster projection/reconciliation/document/mutation-guard tests; run the relevant Playwright spec and npm run build. Inspect configuration first: package.json has no generic npm test script.

## Completion criteria

The intended edge disappears after one valid click; the button consistently appears on hover and remains reachable during a 150 ms leave grace period; edges are slightly thicker across their supported variants; canonical identities, separate handles, clusters, history and save/reload remain correct; no broad graph subscriptions or hover-driven document writes are added.

This review was source-based. The exact runtime cause of repeated deletion remains to be reproduced; the hover weaknesses and inconsistent widths are confirmed from current dev code.
