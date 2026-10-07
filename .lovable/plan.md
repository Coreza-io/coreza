# Fix cluster save, in-cluster copy/paste, and full Loop runs in Execute Cluster

## Outcome

1. A workflow saves even when a cluster contains nodes that are not wired to each other.
2. Inside an open cluster, Ctrl/Cmd+C then Ctrl/Cmd+V pastes copies into that same cluster, and one undo removes the whole paste.
3. Execute Cluster runs a Loop's body once per item until the Loop reports `done`, then runs the `done` side once. Today the body runs only once.

Unchanged: cluster creation rules, collapse/expand, the execution lock, node action snapshots, undo history, the read-only canvas, and the recent drag-performance work.

## What the code shows

Every claim in the document was checked against this checkout.

### 1. Save fails with `400 disconnected-members`

- The editor (`src/domain/clusters/validate.ts`) checks connectivity only when `requireConnectedMembers` is set. That flag is used only by `validateClusterSelection`, which runs when a cluster is created.
- The server (`coreza-backend/src/workflow/validateNodeClusters.ts`, line 152) always rejects disconnected members.
- `WorkflowQueryService` runs that server check on create and update, so the editor sends a document it accepts and the server rejects it.
- The other rules already match on both sides: multiple entry/exit, entry-not-root, exit-not-leaf, no-entry-exit-path, attachment boundary, and the Loop boundary exception.
- The old server-side scoped cluster run (`clusterExecution.ts`, line 188) uses the same check. The editor no longer uses that run path, so relaxing the rule does not change editor behavior.
- **Dependency with item 2:** pasting copies into a cluster makes that cluster disconnected by design. In-cluster paste would therefore hit the same save error unless item 1 ships first.

### 2. Paste is blocked inside a cluster

- `WorkflowEditor` keydown handler, line 2212: `if (focusedClusterId || !clipboardRef.current) return;`. Copy works; paste is deliberately ignored.
- Overview paste updates nodes, edges and clusters in three separate calls with no single history entry. Edges are appended with a direct `setEdges` call.
- Paste cannot cause these cluster problems:
  - Copied edges are kept only when both ends are inside the copy, so a paste never adds a connection that crosses the cluster edge. That rules out new entry or exit violations.
  - `copiedClusters` holds only clusters whose members were all selected. Re-creating them inside an open cluster would give one node two cluster memberships.
- The keydown effect reads `focusedClusterId`, but its dependency list does not include it, so the handler can act on a stale value.
- `insertNodesInDocument` (in `documentCommands.ts`) already validates node, edge and cluster-membership insertion together, using `targetClusterId` and `expandedClusterId`. Palette insertion already uses it with one history push and `restoreDocument`.
- Paste does not remap `$('oldId')` references inside the copied nodes' settings. `remapNodeReferences` exists for this.

### 3. Loop runs only once in Execute Cluster

- In `useNodeExecution`, the Loop action handles one item per call. While items remain it returns `selectedContinuation: "loop"`. On the call after the last item (`loopIndex > maxLoopIndex`) it returns `"done"` with the final aggregate. N items therefore take N+1 Loop calls.
- In each call the Loop reads feedback from `executionStore.getNodeData(loopId)._edgeBuf`, then clears it.
- `useClusterExecution.executeCluster` walks a fixed list (`plan.executableNodeIds`) once. For a Loop it only marks the other branch as skipped, and it never calls the Loop again. It also keeps one `skipped` set for the whole run.
- Only `WorkflowExecutor.aggregateToLoop` writes `_edgeBuf[edge.id]`. The cluster runner never writes feedback, so even with repetition the Loop's final aggregate would be empty.
- `findLoopFeedbackEdgeIds` already identifies the validated body-to-Loop return connections.
- `tests/useClusterExecution.test.ts` currently asserts the single-pass behavior; that test changes.

## Plan

### Part 1: Allow saving disconnected cluster members

1. In `validateNodeClusters.ts`:
   - add a `requireConnectedMembers` option, default `false`, matching the editor;
   - apply `disconnected-members` only when the option is set;
   - leave every other rule untouched.
2. Keep the editor creation check (`validateClusterSelection`) as is. Creating a cluster from unconnected nodes is still refused.
3. Server tests in `validateNodeClusters.test.ts`:
   - a cluster with an unwired member is accepted;
   - unknown member, overlapping membership, trigger member, attachment crossing the boundary, multiple entry, multiple exit and missing entry-to-exit path are still rejected;
   - the Loop boundary is still accepted;
   - with the option on, disconnected members are rejected.
4. Shared fixture: run one fixture set through both the editor validator and the server validator and assert they give the same verdicts. This catches future drift between them.
5. Save in the editor: reproduce the `400` first, then confirm the save succeeds. Reload and confirm the cluster and its unwired member are still there.
6. Execute Cluster with an unwired member: the member runs once, as an independent root, and fail-fast still applies.
7. The backend repository is separate: the change must also be copied to `coreza-io/coreza-backend` and deployed. Until the server is redeployed, the live save stays broken.

### Part 2: Paste inside an open cluster

1. Remove `focusedClusterId` from the paste guard so the handler returns only when the clipboard is empty.
2. Keep the existing new-ID, position-offset, display-name and edge-ID logic. Build the new nodes and edges from `nodesRef`, `canonicalEdgesRef` and `clustersRef`, not render-time state.
3. Remap references inside the copied nodes' settings with `remapNodeReferences`. Only old copied IDs map to their new IDs. References to nodes outside the copy stay unchanged.
4. **When a cluster is open:**
   - call `insertNodesInDocument` with the new nodes and edges, with both `targetClusterId` and `expandedClusterId` set to the open cluster;
   - ignore `copiedClusters`;
   - on success, push one document history entry and apply the result with `restoreDocument`. The pasted nodes end up selected and the cluster stays open;
   - on failure, show the returned message and change nothing, with no history entry.
5. **In the overview:** keep the current behavior, including recreating whole copied clusters with new titles. Make it atomic: build the full document (nodes, edges, clusters), validate it, push one history entry, then `restoreDocument`. This replaces the three separate updates.
6. Add `focusedClusterId` and the refs the handler uses to the keydown effect's dependency list.
7. Toast "Selection pasted" only after a successful paste.

### Part 3: Execute Cluster completes every Loop iteration

1. **Keep the planner.** `buildClusterExecutionPlan` keeps handling membership, capability filtering, ordering, expression dependencies and generic-cycle rejection.
2. **Loop regions.** Add a pure helper `buildLoopRegions(plan, edges, nodeById, allowedNodeIds)` that returns one entry per executable Loop: `{ loopNodeId, feedbackEdgeIds, bodyNodeIds, doneStartNodeIds }`.
   - It uses main connections inside the cluster only.
   - `loopStarts` are the targets of the `loop` handle; `doneStarts` are the targets of the `done` handle.
   - The body is everything reachable from `loopStarts` that can also reach a feedback source, computed with the feedback connections removed. A node merely reachable from the Loop is not enough, so a `done` branch that merges back in is not repeated.
   - Body nodes stay in plan order.
3. **Unsupported shapes are rejected up front.** These fail before anything runs, with a clear message:
   - two Loops whose bodies overlap or nest;
   - a body node that is also on the `done` side;
   - a Loop with a `loop` branch but no feedback connection.

   Separate Loops placed one after another are supported.
4. **One shared step runner.** Pull the per-node steps of `executeCluster` into a local `runPlannedNode(nodeId, skippedSet)`:
   - cancellation and session/generation checks;
   - progress update;
   - `actionSnapshot.execute`;
   - cancelled/failed handling, which marks pending nodes and returns early;
   - If/Switch branch skipping;
   - listener-started skipping.

   The outer pass and the Loop runner both use it, so errors and cancellation follow a single path.
5. **Loop runner.** When the outer pass reaches a Loop, it calls `runLoopRegion(region)`:

   ```text
   repeat:
     outcome = run Loop
     "done"  -> stop
     "loop"  -> run each body node once, with a fresh skipped set for this pass
                after each feedback-source node succeeds, write its output to the Loop's feedback buffer
     other   -> fail: "unsupported control result"
   then: the outer pass continues; done-side nodes run once
   ```

   - The outer pass skips body nodes, which the Loop runner owns.
   - If/Switch skipping inside the body uses a set created per iteration, so a branch skipped in one pass can run in the next.
   - Skipping outside the body keeps the existing global set.
   - Add a safety cap of item count + 1 Loop calls, falling back to 10,000. If it is exceeded, the run fails with a clear message instead of hanging.
6. **Feedback.** Give `useClusterExecution` a narrow `writeLoopFeedback(loopId, edgeId, value)` callback, supplied by `WorkflowEditor` from `executionStore`.
   - It mirrors `aggregateToLoop`: it merges `{ [edgeId]: value }` into the existing `_edgeBuf` and keeps other entries.
   - The next Loop call reads and clears the buffer as it already does.
   - Pinned body outputs count as normal successful outputs.
7. **Stop and failure rules:**
   - stop pressed before a Loop call, or during the body: no further Loop or body calls, status "cancelled";
   - a body or Loop failure fails the cluster immediately, and the remaining nodes are marked blocked;
   - if the session changes, the run stops without reporting completion;
   - the lock is released on every exit, as today.
8. **Progress shape stays the same.** `phase`, `currentNodeId`, `completed`, `eligible` and `outcomes` are unchanged:
   - `eligible` stays the number of unique nodes;
   - `outcomes[nodeId]` holds the latest result;
   - `completed` is capped at `eligible`.

   The cluster card needs no change.
9. **Unchanged:** do not switch cluster runs to `WorkflowExecutor.executeAll()`, add a server run, or change graph structure during a run. Single-node Execute and Run All behave exactly as before.

## Tests

### Server and shared rules
- The cases listed in Part 1, steps 3 and 4.

### Paste (editor command tests)
- **In an open cluster:** new IDs; internal connections remapped; pasted nodes join the open cluster; no cluster copied; originals untouched; pasted nodes selected; one history entry, and undo removes all of it.
- **Failure:** a rejected insert changes nothing and adds no history entry.
- **Overview:** copying a whole cluster still creates a renamed copy of the cluster; one undo removes the whole paste.
- **References:** references between copied nodes point to the new copies; references to outside nodes are unchanged.
- **Save after paste:** the cluster saves after an in-cluster paste.

### Loop (`tests/useClusterExecution.test.ts`)
- Replace the single-pass test. The Loop returns loop, loop, loop, done. Expected order: upstream, loop, body, loop, body, loop, body, loop, doneNode, after.
- The body runs exactly once per `loop` result, and the done node never runs before `done`.
- No body node runs again after `done`.
- An If inside the body takes a different branch in iteration 2 than in iteration 1, and both run correctly.
- The body fails in iteration 2: no third Loop call, and the cluster is marked failed.
- Stop during iteration 2: no further calls, status cancelled, lock released.
- The feedback writer receives `feedbackEdgeId -> body output` before each next Loop call.
- Pinned body output still schedules correctly.
- Two Loops in sequence both complete. Overlapping Loop bodies are rejected before anything runs.
- The safety cap stops a Loop that never returns `done`.
- Existing ordering, fail-fast and non-Loop tests still pass unchanged.

### Browser checks
- Save a cluster with an unwired node, then reload.
- Open a cluster, copy two connected members, paste, check, undo.
- Execute a cluster where a Loop runs over 3 items: the body shows 3 runs, the `done` side runs once, and the Loop output panel shows the full aggregate.

## Order of work

1. Write failing tests for all three issues.
2. Server save fix and shared fixture; this must come before paste.
3. Paste: open-cluster branch, atomic overview, dependencies, references.
4. Loop: regions helper, shared step runner, Loop runner, feedback writer, cap.
5. Type check, focused Jest (editor and backend), lint on changed files, `git diff --check`, preview build, browser checks.
6. Copy the backend change to `coreza-io/coreza-backend` and redeploy.
7. Update `AGENTS.md`:
   - Persisted clusters may contain disconnected members; only cluster creation requires connectivity. The editor and server validators must agree.
   - Cluster Execute repeats a Loop's body per iteration through the normal node actions and writes Loop feedback the same way Run All does.

## Files

**Server:**
- `coreza-backend/src/workflow/validateNodeClusters.ts` and its test.

**Editor:**
- `src/pages/WorkflowEditor.tsx`: paste branches, atomic overview paste, effect dependencies, feedback writer supplied to the cluster runner.
- `src/hooks/useClusterExecution.ts`: shared step runner, Loop runner, per-iteration skipping, cap.
- `src/domain/clusters/loopRegions.ts`: new pure helper.
- Possibly `src/domain/clusters/documentCommands.ts`: a small overview paste helper, only if needed for atomic overview paste.

**Tests:**
- `tests/useClusterExecution.test.ts`
- `tests/domain/clusters.test.ts` (shared fixture)
- `tests/domain/clusterDocumentCommands.test.ts` (paste)
- `tests/domain/loopRegions.test.ts`

**Not changed:** projection, reconciliation, routing, collapse/expand, single-node Execute, Run All and `WorkflowExecutor`.

## Open items
- The server fix needs the separate backend repository updated and redeployed.
- Browser checks need a signed-in preview session.
