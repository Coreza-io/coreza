# Fix connections that need two deletes

## Outcome

One click on a connection's trash button removes it permanently. It does not reappear on the next render, after undo/redo, or after save and reload. Legitimate parallel connections (different handles), self-loops, cluster behavior and the recent drag-performance work stay unchanged.

## What the code shows

The uploaded document's most likely cause is duplicate stored connections. Reading the code points to a different, more specific cause first. It has not been reproduced in a running browser yet; step 1 confirms it.

### Likely root cause: the deleted connection is restored by the same click

1. The trash button in `EdgeManager` (both `PlugEdge` and `InteractiveEdge`) calls `data.onRemoveEdge` and does **not** stop the click from bubbling.
2. The button sits inside React Flow's edge wrapper. Its click handler runs first: `removeEdge` queues `setEdges(filtered)`.
3. The same click then reaches React Flow's edge wrapper, which calls `addSelectedEdges([id])`. That emits a `select` change to `onEdgesChange`.
4. `onEdgesChange` treats `select` as non-structural and calls `setEdges(applyEdgeChanges(changes, edges))`. Here `edges` is the stale render-time array that still contains the deleted connection. That update is queued last, so it wins and the connection comes back, now selected.
5. On the second click the connection is already selected. React Flow's `getSelectionChanges` emits nothing, so nothing restores it and the delete sticks.

This matches the reported "first click fails, second click works" exactly, with no duplicate data involved.

### Other confirmed facts

- React Flow's `addEdge` already rejects exact duplicates (same source, target and handles, treating missing handles as equal). `onConnect` therefore cannot normally create a duplicate.
- Paths that bypass the commit boundary or any duplicate check:
  - workflow load in `useWorkflowPersistence`;
  - version restore;
  - template load;
  - undo/redo `restoreDocument`;
  - paste (`setEdges((eds) => [...eds, ...newEdges])`);
  - Loop "+" (`setEdges((es) => [...es, newEdge])`);
  - node delete in `NodeWrapper` (`setEdges` filter, with no history entry).

  Paste and Loop always create new node IDs, so they cannot duplicate an existing connection. Load, restore and undo/redo can carry duplicates that were already saved.
- `commitEdgeCandidate` validates against render-time `nodes`, `edges` and `clusters`, not the latest refs. It also saves history even when the candidate equals the current edges.
- Cluster projection maps each stored connection to exactly one displayed connection, and reconciliation follows removals. Nothing indicates it causes this bug, so it stays unchanged.
- The read-only `WorkflowCanvas` has its own handlers and is not part of the editor delete path. It stays unchanged.

## Plan

### 1. Confirm the cause before changing behavior

Add development-only diagnostics, behind `import.meta.env.DEV`, at three points:
- `removeEdge`: requested ID, whether it exists, edge count before and after, and every edge with the same source/handle/target/handle.
- `commitEdgeCandidate`: edge count before and after.
- `onEdgesChange`: change types, and whether any change targets an ID that is no longer in the latest edges.

Reproduce in the preview: connect two nodes, hover, click delete once.
- Expected under the main hypothesis: one matching connection before the delete, zero after, then a `select` change that brings it back.
- If two matching connections exist before the first delete, duplicates are confirmed as well, and step 4 becomes primary.

Remove the logs once confirmed, or keep them dev-only.

### 2. Stop control clicks reaching the edge underneath (primary fix)

In `EdgeManager`, for every edge control button in both `PlugEdge` and `InteractiveEdge`:
- call `stopPropagation()` on pointer down, mouse down and click before running the action;
- add the `nodrag nopan` classes so the click cannot start a canvas pan or drag.

Keep icons, styles, hover behavior and routing unchanged. Do not touch the selectors added for drag performance.

### 3. Make edge updates stale-proof (defense in depth)

In `WorkflowEditor`:
- Non-structural `onEdgesChange` changes (select, hover): apply them to the **latest** edges with `setEdges((current) => applyEdgeChanges(changes, current))`, and drop changes whose edge ID no longer exists. A late selection event then cannot bring a deleted connection back.
- `commitEdgeCandidate`: validate against `nodesRef`, `canonicalEdgesRef` and `clustersRef` rather than render-time values, and update `canonicalEdgesRef` at the same time as `setEdges`.
- `onConnect`: build the candidate from `canonicalEdgesRef.current`, not the `edges` captured at render.

### 4. One stored connection per exact endpoint (from the document)

Add `src/domain/workflowEdges.ts` with three pure helpers:
- `getLogicalEdgeKey`: source, normalized source handle, target, normalized target handle; `null`, `undefined` and `""` all mean "no handle".
- `areSameLogicalConnection`.
- `dedupeLogicalEdges`: keeps the first edge, preserves order, never mutates input, and returns the **same array** when there are no duplicates.

Never deduplicate by source and target alone. `A.out1 -> B.in` and `A.out2 -> B.in` are both kept.

Apply it at these points:
- **`commitEdgeCandidate`:** normalize before cluster validation, history, `setEdges`, and the "Dissolve cluster and apply" action.
- **No-op guard:** if the normalized candidate has the same edge IDs in the same order as the current edges, return without a history entry or `setEdges`. A repeated identical connect then adds no undo step.
- **`onConnect`:** if the exact connection already exists, return before generating an ID. This is a fast path only; the commit boundary stays authoritative.
- **Workflow load (`useWorkflowPersistence`):** after restoring the delete callbacks, remove exact duplicates. Never change endpoints or handles, which respects the existing "never repair persisted endpoints" rule. Mark the loaded state as the saved baseline so the workflow does not open as "unsaved". The cleaned list is stored on the next explicit save.
- **Version restore, template load and undo/redo `restoreDocument`:** apply the same normalization.
- **Paste:** apply normalization to the combined list as a guard. New node IDs make duplicates impossible here today.
- **Loop "+":** route through `commitEdgeCandidateRef.current` using the latest edges, instead of a direct `setEdges` append.

Leave run-highlight and loop-payload `setEdges` calls in `workflowExecutor` alone; they never add or remove connections.

### 5. Node delete from the node menu

`NodeWrapper.confirmDeleteNode` removes the node and its connections directly, with no undo entry and no cluster handling. This is a separate structural bypass. Record it as a follow-up and do not change it in this fix, unless step 1 shows it involved.

### 6. Keep delete by ID

`removeEdge(edgeId)` keeps deleting exactly one connection by ID. With steps 2–4 in place, one visible connection means one stored connection, so one delete removes it.

## Tests

### Unit (`tests/domain/workflowEdges.test.ts`)
- Two identical connections with different IDs keep only the first.
- Different source handles keep both; different target handles keep both.
- `undefined`, `null` and `""` handles count as the same.
- Self-loop is kept.
- Input is not mutated, and a list with no duplicates returns the same array.
- Removing the remaining connection by ID leaves zero matching connections.

### Edge commit and cluster behavior
- Normalization happens before cluster validation, so a repeated exact boundary or internal connection shows no "would invalidate a cluster" toast.
- Separate-handle boundary connections stay separate.
- A duplicate-only candidate creates no history entry; a real delete creates exactly one.
- A stale `select` change for a removed ID is dropped and does not restore the connection.

### Load and restore
- A saved workflow containing two exact duplicates loads as one connection, opens as saved, and keeps parallel different-handle connections.

### Browser (Playwright fixture)
- Connect two nodes and see one connection. Hover, click delete once: no connection, and none after the next frame.
- Reconnect: exactly one appears.
- Load a fixture with stored duplicates: one connection appears and one delete removes it.
- Undo after delete restores one connection; redo removes it.

## Acceptance
- One click removes a connection, and it stays removed.
- Repeating an identical connection adds nothing and no undo step.
- Saved duplicates are cleaned on open, with no change to endpoints or handles.
- Parallel different-handle connections, self-loops, cluster collapse/expand and validation, rename, Execute, drag performance and save/reload all behave as before.
- Type check, lint on changed files, focused Jest suites, the browser test, `git diff --check` and the preview build all pass.

## Files

- `src/components/workflow/EdgeManager.tsx`: stop click propagation on edge controls, plus `nodrag nopan`.
- `src/pages/WorkflowEditor.tsx`: stale-proof edge changes, ref-based commit with normalization and no-op guard, `onConnect` fast path, Loop/paste/restore/template through the same rule, temporary dev diagnostics.
- `src/hooks/useWorkflowPersistence.ts`: remove exact duplicates on load.
- `src/domain/workflowEdges.ts`: new pure helpers.
- Tests as listed above.
- `AGENTS.md`: one rule — stored connections are unique per exact source/handle/target/handle, enforced at the edge commit boundary and on load.

Not changed: `projection.ts`, `reconcileProjection.ts`, routing math, cluster layout/drag, execution, and the read-only `WorkflowCanvas`.

## Separate item from the previous drag-lag review

The previous review found one open risk. Projection reuse can hand React Flow an older copy of a visible node whose stored object changed in ways deeper than the comparison checks. It also found that the drag-performance rule was glued onto the end of the previous line in `AGENTS.md`. Fix both alongside this work:
- always pass through the exact stored node or connection object, and reuse only objects the projection itself creates (hidden hosts, cluster cards, rewritten boundary connections);
- put the `AGENTS.md` rule on its own line.
