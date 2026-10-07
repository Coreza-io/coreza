# Fix cluster save, in-cluster copy/paste, and full Loop execution

## Scope

Fix three editor/cluster regressions with the smallest practical changes:

1. **Saving a workflow fails with `400 disconnected-members` when a cluster contains nodes that are not connected.**
2. **Copy/paste does not work while a cluster is expanded/focused.**
3. **Execute Cluster runs a Loop body only once instead of running the body for every Loop iteration until the Loop reaches `done`.**

The fixes should preserve the existing canonical-document model, cluster projection/collapse behavior, execution lock, node action snapshotting, undo/history behavior, and recent drag-performance work.

---

# 1. Saving a cluster with disconnected members

## Confirmed root cause

The frontend and backend currently enforce different persisted-cluster rules.

### Frontend

`src/domain/clusters/validate.ts`

`validateClusters(...)` defaults to:

```ts
requireConnectedMembers: false
```

Connectivity is intentionally enforced only when *creating a cluster selection*:

```ts
validateClusterSelection(...)
  -> validateClusters(..., { requireConnectedMembers: true })
```

There is already a frontend test proving persisted clusters may contain an unwired member.

That means the current frontend model is:

- cluster creation requires a connected selection;
- later editor changes may leave members disconnected;
- the document remains saveable as long as the other cluster invariants are valid.

### Backend

`coreza-backend/src/workflow/validateNodeClusters.ts`

The persisted-document validator unconditionally does:

```ts
if (visited.size !== members.size) invalid("disconnected-members");
```

The create/update workflow API calls this validator before writing the workflow. Therefore the editor accepts the document, sends it, and the backend rejects it with the exact screenshot error:

```
400 Bad Request
disconnected-members
```

This is a validation-policy mismatch, not a network/API-client problem.

## Desired behavior

Persisted clusters should use the same rule on frontend and backend:

- disconnected members are allowed in an existing cluster;
- cluster metadata must still reference real nodes;
- no overlapping membership;
- no trigger member;
- attachment boundary rules remain enforced;
- multiple-entry / multiple-exit constraints remain enforced where applicable;
- supported Loop boundary rules remain enforced.

Cluster **creation** should continue requiring connected nodes.

## Minimal implementation

### 1.1 Remove persisted connectivity rejection from backend topology validation

File:

`coreza-backend/src/workflow/validateNodeClusters.ts`

Do not remove topology analysis entirely. Only stop rejecting the document because `visited.size !== members.size`.

The adjacency traversal can be removed if it has no other consumer, or retained if useful for future diagnostics. Prefer the smaller clean diff.

Do **not** weaken:

- `unknown-semantics`
- `attachment-boundary`
- `multiple-entry-members`
- `multiple-exit-members`
- `entry-not-root`
- `exit-not-leaf`
- `no-entry-exit-path`
- Loop boundary validation

### 1.2 Keep frontend creation-time connectivity unchanged

Do not change:

`validateClusterSelection(... requireConnectedMembers: true)`

A newly created cluster should still begin as a valid connected selection.

### 1.3 Add backend parity tests

Update:

`coreza-backend/src/workflow/validateNodeClusters.test.ts`

Add a persisted-document case such as:

```
cluster members = [a, b, unwired]
edge = a -> b
```

Expected: accepted and normalized.

Also retain/add negative tests showing that relaxing connectivity does not accidentally permit:

- missing member;
- overlapping member;
- invalid boundary attachment;
- multiple external entry members;
- unsupported Loop boundary.

### 1.4 Verify cluster execution with disconnected members

The editor `buildClusterExecutionPlan` already supports unwired executable members and has a test:

> includes an unwired eligible member once in deterministic membership order

Keep that behavior.

Backend `compileClusterExecutionPlan` also creates entry activations for executable nodes with no incoming internal edge, so disconnected roots remain independently executable.

No scheduler change is required for issue 1.

---

# 2. Copy/paste inside an expanded cluster

## Confirmed root cause

`src/pages/WorkflowEditor.tsx`

Copy itself uses canonical selection and works while a cluster is focused.

Paste is explicitly disabled:

```ts
if (focusedClusterId || !clipboardRef.current) {
  return;
}
```

So Ctrl/Cmd+C succeeds, but Ctrl/Cmd+V is deliberately ignored whenever the user is inside an expanded cluster.

The current overview paste path also mutates three pieces of canonical state separately:

```ts
setNodes(...)
setEdges(...)
setClusters(...)
```

The editor now has a safer transaction helper:

`insertNodesInDocument(...)`

which already supports:

```ts
targetClusterId
expandedClusterId
```

and atomically validates node/edge insertion plus cluster membership.

## Desired behavior

When a cluster is expanded/focused:

- user selects one or more member nodes;
- Ctrl/Cmd+C copies them;
- Ctrl/Cmd+V creates new node IDs and edge IDs;
- copied internal edges are remapped to the new node IDs;
- pasted nodes are added to the **currently focused cluster**;
- pasted nodes remain selected;
- original nodes remain unchanged;
- the source cluster itself is **not cloned** inside itself;
- one undo should undo the whole paste transaction.

When no cluster is focused, existing overview paste behavior should remain unchanged, including copying complete clusters when the full cluster was copied.

## Minimal implementation

### 2.1 Remove the blanket focused-cluster paste block

Change the guard from:

```ts
if (focusedClusterId || !clipboardRef.current) return;
```

to only block when the clipboard is empty or an editor mutation/execution is currently unsafe.

Use the same mutation guards already used by node insertion where appropriate:

- active cluster move;
- active node drag;
- execution lock;
- invalid cluster metadata.

Do not invent a second editor-state policy if an existing guard can be reused.

### 2.2 Reuse the existing ID/position remapping logic

Keep the current logic for:

- new node IDs;
- unique display names;
- position offset from the mouse location;
- edge endpoint remapping;
- new edge IDs;
- `onRemoveEdge` callback rebinding.

Avoid rewriting the clipboard feature from scratch.

### 2.3 Use a document transaction for focused-cluster paste

After `newNodes` and `newEdges` are built, branch by editor scope.

If `focusedClusterId` is set:

```ts
insertNodesInDocument(
  { nodes: currentNodes, edges: currentEdges, clusters: currentClusters },
  {
    nodes: newNodes,
    edges: newEdges,
    targetClusterId: focusedClusterId,
    expandedClusterId: focusedClusterId,
  },
)
```

On success:

- push exactly one document history entry;
- restore the returned document with `restoreDocument`;
- preserve selection on the newly pasted nodes;
- keep the same focused cluster open.

On failure:

- do not partially add nodes/edges;
- show the returned message;
- do not create a history entry.

This keeps node, edge, and cluster membership atomic.

### 2.4 Do not clone source cluster metadata during in-cluster paste

The clipboard stores complete copied clusters only when every member was selected:

```ts
clusters.filter((cluster) =>
  cluster.memberNodeIds.every((id) => selectedNodeIds.has(id))
)
```

That behavior is useful in overview mode.

Inside a focused cluster, however, cloning `copiedClusters` would create overlapping membership.

Therefore:

- **focused cluster paste:** ignore `copiedClusters`; add pasted nodes to the existing focused cluster.
- **overview paste:** keep current full-cluster clone behavior.

### 2.5 Add the missing hook dependency

The keydown effect reads `focusedClusterId`; ensure it is included in the effect dependency list after paste becomes scope-dependent.

Also prefer the existing refs (`nodesRef`, `canonicalEdgesRef`, `clustersRef`, `focusedClusterIdRef`) at the mutation point if they avoid stale state during a rapid copy/paste interaction.

Do not perform a broad effect refactor unless needed.

### 2.6 Optional small correctness improvement: reference remapping

The current paste logic remaps edge endpoints but not expression references inside copied node values.

There is already a repository utility:

`remapNodeReferences`

Do not expand this fix unless tests show copied intra-selection references are broken. If touched, remap only references from old copied IDs to their corresponding new IDs and leave references to nodes outside the copied selection unchanged.

This is secondary to the requested cluster paste fix.

## Tests

Add a focused paste test/helper test that proves:

- source cluster = `[a, b]`;
- copy `a`;
- paste while source cluster is focused;
- new node exists;
- source cluster membership now includes the new node;
- no second cluster is created;
- undo restores the exact prior document.

Add a multi-node case:

- copy `a -> b`;
- paste inside focused cluster;
- pasted edge points only between the two new IDs.

Add overview regression:

- copying a complete cluster in overview still creates a new cluster with a new UUID/title.

---

# 3. Execute Cluster must complete all Loop iterations

## Confirmed root cause

There are two different execution models in play.

### Loop node manual action

`src/hooks/useNodeExecution.ts`

The Loop node is intentionally **step-based**.

One invocation processes one batch/item and returns:

```ts
selectedContinuation: "loop"
```

while more items remain.

Only a later invocation, after the loop index advances past the last item, returns:

```ts
selectedContinuation: "done"
```

For an array with N single-item iterations, the normal pattern is effectively:

```
Loop -> body
Loop -> body
...
Loop -> body
Loop -> done
```

### Cluster runner

`src/hooks/useClusterExecution.ts`

The cluster runner builds a static topological list and executes every executable node at most once:

```ts
for (const nodeId of plan.executableNodeIds) {
  await actionSnapshot.execute(nodeId, ...)
}
```

The runner recognizes Loop as a branch-control node, but it only uses the Loop result to select one continuation in that single pass.

Therefore:

1. Loop runs once and returns `loop`;
2. body runs once;
3. Loop is never called again;
4. execution reaches the end of the static plan.

The existing test currently codifies this incomplete behavior:

> executes only the loop continuation of a manual Loop step

That test should be replaced with the full-loop contract.

## Desired behavior

Execute Cluster should use the same Loop semantics users expect from full workflow execution:

For each Loop inside the cluster:

1. execute prerequisites before the Loop once;
2. execute Loop;
3. if Loop selects `loop`, execute the selected body path once;
4. feed the body return result back to Loop aggregation state;
5. execute Loop again;
6. repeat until Loop selects `done`;
7. then execute the `done` continuation once;
8. continue the remaining cluster plan.

Example for 3 items:

```
upstream
Loop(item 0)
  body
Loop(item 1)
  body
Loop(item 2)
  body
Loop(done)
after
```

Not:

```
upstream
Loop(item 0)
body
after
```

## Constraints

Keep the existing editor-local cluster execution architecture:

- one editor execution lock;
- snapshot node actions before execution;
- no backend workflow run just to execute an editor cluster;
- respect cancellation;
- fail fast;
- no node outside the cluster;
- preserve If/Switch control-flow semantics;
- preserve pinned node behavior;
- do not mutate graph structure during execution.

Do not replace cluster execution with `WorkflowExecutor.executeAll()`; that would broaden execution outside the selected cluster and change semantics.

---

## Minimal execution design

### 3.1 Separate static planning from dynamic Loop scheduling

Keep `buildClusterExecutionPlan` for:

- membership validation;
- executable capability filtering;
- prerequisite ordering;
- expression dependencies;
- feedback-edge identification;
- generic-cycle rejection.

Add a small derived Loop descriptor/helper rather than replacing the planner.

Suggested internal shape:

```ts
interface LoopExecutionRegion {
  loopNodeId: string;
  feedbackEdgeIds: string[];
  bodyNodeIds: string[];
  doneStartNodeIds: string[];
}
```

Derive it only from main edges inside the allowed cluster.

### 3.2 Identify the actual Loop body safely

For each executable Loop:

- `loopStarts` = targets of outgoing handle `loop`;
- `doneStarts` = targets of outgoing handle `done`;
- `feedbackEdges` = the existing validated edges whose target is the Loop and whose source is reachable from the loop branch.

Do not define the body as every node merely reachable from `loopStarts`, because a body and done branch can theoretically converge.

Prefer:

```
body =
  nodes reachable forward from loopStarts
  INTERSECT
  nodes that can reach a feedback-edge source
```

using the graph with Loop feedback edges removed.

This scopes repeated execution to the actual iterative region.

### 3.3 Treat Loop as a dynamic control construct in `executeCluster`

When the outer deterministic plan reaches a Loop:

- do not process it with the generic one-shot Loop branch logic;
- call a focused `executeLoopRegion(...)` helper;
- mark Loop-body nodes as handled by that helper so the outer pass does not run them again.

Pseudo-flow:

```ts
while (true) {
  const loopOutcome = await execute(loopId)

  if (loopOutcome.selectedContinuation === "done") break
  if (loopOutcome.selectedContinuation !== "loop") fail

  await executeBodyOnce(loopRegion)
}
```

Then allow the outer plan to continue through the `done` side.

### 3.4 Reset branch-skipping per iteration

The current cluster runner has one global `skipped` set.

That is fine for one-shot If/Switch execution, but wrong for Loop iterations because a body branch skipped in iteration 1 might be selected in iteration 2.

Inside a Loop body:

- create an iteration-local skipped set;
- apply existing If/Switch branch resolution for that iteration;
- discard it before the next iteration.

Do not carry Loop-body branch skips across iterations.

### 3.5 Reuse one node-execution helper

Extract the duplicated per-node mechanics inside `executeCluster` into a local helper, e.g.:

```ts
executePlannedNode(nodeId, context)
```

It should keep the existing behavior for:

- cancellation;
- generation/session checks;
- state updates;
- `actionSnapshot.execute`;
- failed/cancelled outcomes;
- control-result decoding.

The Loop orchestration should call this same helper so normal and repeated nodes share exactly one error/cancellation path.

This is a refactor only as far as required for Loop repetition; avoid redesigning the hook.

### 3.6 Preserve Loop feedback aggregation

There is an important difference between ordinary manual node execution and full workflow Loop execution.

`useNodeExecution` reads Loop feedback from:

```ts
executionStore.getNodeData(loopId)._edgeBuf
```

The normal `WorkflowExecutor` writes the body result into that buffer for feedback edges.

The current cluster runner does not.

Without fixing this, repeated iteration can advance through items, but Loop aggregate/final output can be wrong or empty.

Minimal solution:

- pass the existing editor `executionStore` into `useClusterExecution` (or expose a narrowly scoped callback);
- after a successful execution of a Loop feedback-source node, write its output into the target Loop's `_edgeBuf[edge.id]`;
- preserve existing buffer entries for the current iteration;
- let the next Loop action consume/clear them using its existing logic.

Mirror the existing `WorkflowExecutor` feedback behavior rather than creating new Loop state semantics.

Prefer a narrow option such as:

```ts
writeLoopFeedback(loopId, edgeId, value)
```

if passing the whole store makes the hook too coupled.

### 3.7 Keep execution state shape stable

Do not introduce a large new cluster-run state model.

Keep:

```ts
phase
currentNodeId
completed
eligible
outcomes
```

For repeated nodes, `outcomes[nodeId]` may represent the latest outcome.

`eligible` should remain the count of unique executable cluster nodes so current UI does not need to change.

If desired, add an optional internal iteration counter later, but it is not required for this fix.

### 3.8 Cancellation and failure rules

During any iteration:

- Abort before Loop -> cancelled.
- Abort during body -> do not invoke Loop again.
- Body node failure -> cluster fails immediately.
- Loop failure -> cluster fails immediately.
- Malformed Loop continuation -> cluster fails.
- `done` -> stop body repetition immediately.
- Session/generation change -> stop without publishing stale completion.

Use the existing lock/controller/generation checks.

### 3.9 Guard unsupported complicated Loop shapes instead of guessing

The current repository already recognizes one supported feedback topology.

For the minimal fix:

- support validated Loop feedback regions;
- support multiple sequential/disjoint Loops if their regions do not overlap;
- if Loop regions overlap/nest in a way the helper cannot unambiguously schedule, fail preflight with a clear error rather than silently executing nodes once.

Do not attempt a broad general-purpose cyclic graph runtime in this change.

---

# Test plan for Loop execution

Update `tests/useClusterExecution.test.ts`.

## Replace the one-shot Loop expectation

Current behavior test effectively expects:

```
loop continuation -> ["loop", "body"]
```

Replace/add a full completion test where the mocked Loop action returns:

```
"loop"
"loop"
"loop"
"done"
```

Expected call order:

```
loop
body
loop
body
loop
body
loop
doneNode
```

### Additional tests

1. **Body receives each iteration**
   - body called exactly once per `loop` continuation.

2. **Done branch is deferred**
   - done node is never called before Loop returns `done`.

3. **No extra body execution**
   - after `done`, body nodes are not run again by the outer static plan.

4. **If/Switch inside body**
   - branch skip state resets each iteration.

5. **Body failure**
   - second iteration body fails -> no third Loop call.

6. **Cancellation**
   - cancel during iteration -> no further Loop/body action.

7. **Feedback aggregation**
   - fake feedback sink/store receives:
     `feedbackEdgeId -> bodyOutcome.output`
     before the next Loop invocation.

8. **Normal cluster regression**
   - existing non-Loop ordering and fail-fast test remains unchanged.

9. **Pinned Loop/body outcome**
   - pinned success remains a valid outcome and does not break scheduling.

---

# Expected production files

## Issue 1

- `coreza-backend/src/workflow/validateNodeClusters.ts`
- `coreza-backend/src/workflow/validateNodeClusters.test.ts`

## Issue 2

- `src/pages/WorkflowEditor.tsx`
- preferably reuse `src/domain/clusters/documentCommands.ts` unchanged
- add focused clipboard/document tests if an existing editor helper test location is suitable

## Issue 3

- `src/hooks/useClusterExecution.ts`
- `src/pages/WorkflowEditor.tsx` only if the cluster hook needs the existing execution store / narrow feedback writer
- `tests/useClusterExecution.test.ts`

Potentially:

- a tiny pure helper under `src/domain/clusters/` if Loop-region derivation makes `useClusterExecution.ts` hard to test/read.

Do not modify unless proven necessary:

- cluster projection/reconciliation;
- CompactClusterNode rendering;
- EdgeManager;
- drag logic;
- workflow activation;
- backend full-workflow Loop executors.

---

# Implementation order

## Phase A — lock regressions with tests

1. Add backend test showing a persisted disconnected cluster is accepted.
2. Add focused-cluster paste regression.
3. Add failing full-Loop cluster execution test with repeated Loop/body call order.

This makes each requested bug reproducible before implementation.

## Phase B — save fix

4. Align backend persisted connectivity policy with frontend.
5. Run backend cluster-validator and workflow API tests.

## Phase C — copy/paste fix

6. Remove focused-cluster paste prohibition.
7. Route focused paste through `insertNodesInDocument`.
8. Commit via one history snapshot + one document restore.
9. Keep overview/full-cluster paste behavior intact.

## Phase D — Loop execution fix

10. Add Loop-region derivation.
11. Extract/reuse per-node execution helper.
12. Add Loop repeat-until-done orchestration.
13. Reset branch skip state for each iteration.
14. Write body feedback outputs into the Loop feedback buffer using existing execution-store semantics.
15. Prevent outer-plan duplicate execution of body nodes.

## Phase E — verification

16. Run frontend TypeScript/build.
17. Run cluster domain tests.
18. Run `useClusterExecution` tests.
19. Run backend cluster validator/workflow tests.
20. Browser/manual verification of all three scenarios.

---

# Manual verification matrix

## Save disconnected nodes

1. Expand/create a cluster.
2. Keep multiple member nodes disconnected.
3. Save.
4. Expected:
   - no `400 disconnected-members`;
   - workflow persists;
   - reload preserves cluster membership and node positions.

Then connect them and save again; no behavior change.

## In-cluster copy/paste

1. Expand cluster.
2. Select one member.
3. Ctrl/Cmd+C.
4. Move cursor within cluster.
5. Ctrl/Cmd+V.
6. Expected:
   - new node appears;
   - it is a member of the same cluster;
   - no duplicate cluster;
   - one undo removes the pasted transaction.

Repeat with two connected nodes and verify their copied internal edge.

## Loop cluster execution

Use Loop input:

```json
[22.6, 24, 30]
```

Expected execution:

```
Loop item 0 -> body nodes
Loop item 1 -> body nodes
Loop item 2 -> body nodes
Loop done -> done continuation
```

Verify body/backend requests occur three times with the three current items, not only for the first item.

If aggregate mode is enabled, verify the Loop final output contains feedback from every iteration.

---

# Acceptance criteria

All are required:

### Save

- A workflow with disconnected nodes inside an existing cluster saves successfully.
- Backend and frontend persisted-cluster validation agree.
- Creating a brand-new cluster from a disconnected selection is still rejected.
- Other topology invariants are unchanged.

### Clipboard

- Copy/paste works while a cluster is expanded.
- Pasted nodes become members of the focused cluster.
- Copied internal edges are remapped to new node IDs.
- No overlapping cloned cluster metadata is created.
- Overview paste behavior is unchanged.
- One undo reverses one paste.

### Cluster Loop execution

- Execute Cluster repeats the Loop body for every Loop iteration.
- Loop is re-invoked until it returns `done`.
- Done continuation runs only after all iterations.
- Body nodes are not executed a second time by the outer plan.
- Loop feedback/aggregation receives each iteration result.
- Failure/cancel stops remaining iterations.
- If/Switch branch state is evaluated independently per iteration.
- Normal non-Loop cluster execution still behaves exactly as before.
- No execution escapes the selected cluster.

### General

- No changes to cluster projection or drag rendering.
- No broad workflow-executor rewrite.
- Type check/build/tests pass.
