# Add nodes inside expanded clusters

## Goal

Allow a palette node to be added at the user’s intended canvas position. When that position or an explicit member-selection anchor belongs to the currently expanded cluster, add the new canonical node to that cluster in the same transaction.

The node must appear immediately, survive collapse/reopen and save/reload, participate in rename, drag, dissolve, and Cluster Execute, and undo/redo atomically. Explicit additions outside the cluster must remain ordinary unclustered nodes.

## Confirmed current gaps

The current checkout confirms the uploaded diagnosis:

- `WorkflowEditor.createNode` refuses every add while `focusedClusterId` is set, appends nodes without changing cluster membership, and does not create a history entry.
- Palette clicks always use the canvas center; there is no remembered canvas or selected-member insertion intent.
- Palette drop uses raw client coordinates minus the canvas rectangle instead of React Flow’s `screenToFlowPosition`, so placement is wrong after zoom or pan.
- Adding `BacktestInit` may also create `OnBar` and an edge, but edges and nodes are committed through separate state writes with no shared validation or undo boundary.
- `validateClusters` always rejects disconnected members. Adding a real but unwired member would therefore block save, reload validation, edge editing, rename validation, and Cluster Execute.
- `projectClusterGraph` still returns early for a focused cluster and hides every outside node. This bypasses the later overlap-only projection path and must be removed before insertion hit-testing relies on expanded-frame behavior.
- Cluster execution already reads canonical membership, includes manually executable members, and orders them deterministically by dependencies and membership order. It does not need a separate execution path for inserted members.
- The current preview build is healthy before implementation.

No backend route, database migration, persisted schema change, or queue change is needed. Cluster membership already persists in `node_clusters`.

## Behavior contract

| User action | Position | Membership |
| --- | --- | --- |
| Drop palette item inside the expanded cluster body | Exact drop point in flow coordinates | Add to that expanded cluster |
| Drop outside the expanded cluster body | Exact drop point | No cluster, even if a member remains selected |
| Click palette after a canvas pointer/click inside the expanded body | Latest valid canvas anchor | Add to expanded cluster |
| Click palette after selecting a member | Deterministic free slot beside that member | Add to that member’s currently expanded cluster |
| Click palette after an explicit outside canvas anchor | Latest outside anchor | No cluster |
| No valid anchor or selection | Current viewport-center fallback | No cluster |
| Captured cluster was collapsed, dissolved, deleted, or belongs to another workflow session | Re-resolve current state; reject an explicit stale target or fall back without inferred membership | Never use stale membership |

Additional rules:

- Only the one currently expanded cluster may receive palette additions. A collapsed card, hidden member position, frame overlap alone, or “a cluster is open” is not sufficient.
- Hit-testing uses the expanded content body, excluding header/footer controls. Button, title, note, Execute, collapse, dissolve, and delete interactions never become insertion anchors.
- Membership is authoritative after creation. The whole node does not need to fit inside the old frame; member bounds naturally enlarge the frame.
- Do not auto-connect the node, re-layout existing members, add React Flow parenting, or modify copy/paste and Loop “add node” behavior in this change.

## Implementation plan

### 1. Finish overlap-only expanded projection

Remove the focused-member early return from `projectClusterGraph` and let focused clusters use the existing shared projection pass.

- Expanded members remain normal visible canonical nodes.
- Unrelated nodes and compact sibling cards are hidden only when their rendered rectangles positively overlap the expanded frame.
- Distant outside nodes and valid boundary edges remain visible.
- Hidden runtime hosts remain mounted and render-only; no projection flags enter canonical state.
- Keep collapse/reopen, rename, Execute controls, runtime ownership, and collision-safe compact IDs unchanged.

Update projection tests to cover outside nodes, sibling compact cards, boundary edges, movement out of overlap, close/reopen, and canonical input immutability through the single projection path.

### 2. Add a pure insertion-position resolver

Create a narrowly scoped cluster insertion helper, using the shared frame geometry and node rectangle fallbacks.

Inputs:

- requested flow position and source (`drop`, `canvas-pointer`, `canvas-click`, or `member-selection`);
- current canonical nodes and clusters;
- current expanded cluster ID;
- optional selected-member ID;
- workflow session ID.

Output:

- final node origin;
- `targetClusterId | null`;
- a typed stale/invalid reason when an explicit target can no longer be honored.

Rules:

- Recompute cluster/frame/member lookup from current canonical state at command time.
- Convert header/footer screen dimensions through the active zoom before excluding them from the flow-space body; do not compare fixed CSS pixels directly with flow coordinates.
- A raw drop is authoritative and overrides older selection or pointer anchors.
- For selected-member placement and repeated palette clicks, search deterministic nearby slots using measured node rectangles with existing size fallbacks and consistent spacing. Preserve all existing positions.
- Clamp an inside anchor away from header/footer controls, but allow the resulting member bounds to grow the frame.
- Fall back to viewport center only when no valid explicit intent exists; fallback never implies membership.

Add pure tests for body/header/footer boundaries, zoom conversion, selected-member placement, repeated placement, stale/deleted targets, collapsed targets, outside overrides, and no-target fallback.

### 3. Track editor-local insertion intent

In `WorkflowEditor`, introduce a session-scoped insertion anchor stored locally/ref-backed so palette movement does not overwrite it.

Capture:

- pointer movement and deliberate pane clicks over the actual React Flow canvas, converted immediately with `rf.screenToFlowPosition`;
- member selection as an ID-based anchor, resolving the member’s current canonical position only when creation occurs;
- whether the point currently belongs to the expanded cluster body.

Lifecycle:

- newest explicit canvas action wins;
- opening/moving through the palette preserves the last canvas anchor;
- workflow changes clear the anchor;
- collapse, dissolve, cluster deletion, member deletion, or stale session invalidates/re-resolves its target;
- cluster header/footer controls and overlays do not update it;
- an outside drop always wins over a previously selected inside member.

Use existing React Flow handlers rather than a new global mouse listener. Replace the global `.workflow-canvas` DOM query for center placement with React Flow instance/viewport data.

### 4. Create one canonical insertion transaction

Add a strict `insertNodesInDocument` command beside the existing cluster-aware document commands. It receives the current canonical document, generated node/edge batch, and optional target cluster ID, and returns a complete candidate or a typed failure.

The command must:

1. clone without mutating the source document;
2. verify every generated node ID and edge ID is unique across the canonical document and within the batch;
3. verify all generated edge endpoints exist in the candidate;
4. reject a missing or stale target cluster instead of partially adding outside it;
5. reject a target that is no longer the editor’s expanded cluster;
6. reject unsupported trigger members or any incompatible generated batch before mutation;
7. append each eligible generated node ID exactly once to the target membership while preserving existing membership order;
8. add all nodes, companion edges, and membership in one candidate;
9. validate the complete candidate under normal persisted-document rules;
10. return no candidate and no dissolved cluster on failure.

Do not use the generic auto-dissolving mutation path. Do not add the node first and attach it later in an effect.

Move collision-safe ID allocation and normal node construction into a pure batch factory used by both palette click and drop. Preserve current labels, definitions, workflow-session data, defaults, and the `BacktestInit + OnBar + edge` behavior. Use stable collision-safe edge IDs and attach the existing remove-edge callback when committing to editor state.

For a targeted batch, every eligible generated companion joins the same cluster. If any generated member is prohibited, reject the whole batch with a clear message. Outside a cluster, preserve the current companion behavior.

### 5. Separate creation-time connectivity from valid persisted membership

Extend cluster validation with an explicit connectivity policy.

- Normal persisted-document validation allows a real member to remain temporarily unwired.
- `validateClusterSelection` explicitly requires connected members, preserving the existing “create a cluster from connected selection” contract and attachment expansion.
- Only the `disconnected-members` rule becomes policy-controlled.
- Keep all other rules unchanged: member existence and uniqueness, one-cluster ownership, trigger exclusion, semantic handles, attachment ownership/boundaries, single entry/exit, root/leaf constraints, and accepted Loop topology.
- Update every caller deliberately: save, load, rename, insertion, edge edits, deletion, and Cluster Execute use normal persisted validation; initial grouping uses connected-selection validation.

Do not add draft membership, pending nodes, synthetic edges, or an insertion-only bypass. The inserted node is immediately a real persisted member.

Add regressions proving an unwired member survives save/load and execution validation while a disconnected initial selection is still rejected. Also prove all non-connectivity violations remain enforced.

### 6. Route palette click and drop through one editor command

Replace direct `setNodes`/`setEdges` creation with one editor-owned `insertPaletteNode` path.

Before candidate construction, reject:

- workflow loading or unavailable canonical state;
- an active node, cluster, or Run All execution lock;
- active node/cluster drag or connection drag;
- unknown manifest type;
- stale workflow session or stale explicit cluster target.

Then:

1. resolve current placement and target membership;
2. build the complete generated batch;
3. run the canonical insertion transaction;
4. push exactly one pre-change document snapshot and clear redo;
5. commit nodes, edges, and clusters together through the existing canonical document restore/apply boundary;
6. select only the new primary node and retain the focused cluster;
7. close the palette only after success;
8. show an insertion-specific failure without changing document, history, focus, or selection.

For drop, pass raw `{clientX, clientY}` to `screenToFlowPosition`; never subtract the canvas bounds first. Keep the expanded frame body non-interactive so drops continue to reach React Flow.

### 7. Preserve downstream behavior

Verify the new canonical member automatically participates in existing behavior without adding special cases:

- expanded frame recomputes from membership and grows around the new node;
- collapse/reopen projects it as the same canonical member and keeps its runtime host mounted;
- compact member count updates once;
- cluster drag moves it; dissolve removes membership only; cluster delete removes it normally;
- rename updates its canonical identity and membership transactionally;
- save/export/reload preserve the node, generated edge, and membership;
- Cluster Execute includes every eligible inserted member and orders edge/reference dependencies normally; an independent unwired member uses deterministic membership order;
- missing configuration or input produces the existing node-level execution outcome;
- Node Execute, Cluster Execute, and explicit Run All retain their current semantics and shared lock.

No automatic wiring, synthetic dependency, outside-node execution, backend execution change, or database work is included.

## Test plan

### Unit and integration tests

- Insertion resolver: coordinate conversion inputs, body-only hit-testing at multiple zooms, explicit outside precedence, selected-member positioning, repeated inserts, stale targets, and fallback.
- Document command: single node, inside membership, outside insertion, duplicate prevention, stale target, trigger rejection, complete `BacktestInit + OnBar + edge` batch, endpoint validation, input immutability, and zero mutation on every failure.
- Validation: persisted disconnected member accepted; disconnected initial grouping rejected; attachment, boundary, entry/exit, Loop, trigger, overlap, and unknown-handle rules unchanged.
- History: insertion creates exactly one entry; undo/redo restores/removes primary node, companion, edge, selection, and membership together.
- Projection: new member remains visible expanded, becomes a hidden mounted runtime host collapsed, frame/member count update, and distant outsiders remain visible under overlap-only behavior.
- Cluster execution: an eligible unwired member appears once in the plan; edge/reference dependencies keep order; unsupported nodes retain current eligibility behavior.

### Browser acceptance using the real editor and palette

1. Open an expanded cluster, point inside its body, click a palette item, and verify intended position, visibility, selection, and one membership increment.
2. Select a member and click a palette item; verify deterministic adjacent placement and membership.
3. Drag/drop inside at non-default zoom/pan; verify the node lands under the pointer in flow space and joins the cluster.
4. With an inside member still selected, drop outside; verify the new node remains unclustered and visible.
5. Move from a valid canvas anchor into the palette; verify the canvas anchor is retained.
6. Repeatedly add nodes; verify collision-safe IDs and non-overlapping nearby positions.
7. Add `BacktestInit` where its companion is generated; verify nodes, edge, and membership commit together or not at all.
8. Collapse/reopen, drag the cluster, rename the new node, dissolve, undo/redo, save, reload, and export; verify canonical identity and membership throughout.
9. Run Node Execute and Cluster Execute; verify the inserted eligible member executes once with normal output/error behavior.
10. Attempt insertion during execution/drag and against a stale or incompatible target; verify no partial node, edge, membership, selection, or history change.

Assert canonical node IDs, edge endpoints, cluster member IDs, and rendered visibility—not only visual node counts.

## Verification and delivery

Run the focused Jest suites for cluster validation, document commands, projection, history, and cluster execution; run the targeted Playwright editor scenario at non-default zoom; then run changed-file lint, the configured TypeScript check, frontend build, and `git diff --check`.

Implementation is accepted when inside additions consistently become visible persisted members at the intended position, explicit outside additions remain outside, unwired members remain valid without weakening other cluster rules, generated batches and undo/redo are atomic, and existing overlap visibility, rename, collapse, and execution behavior remain intact.
