# Fix duplicate/overlapping edges that require two deletes

## Problem

In the workflow editor, a connection can visually remain after the user clicks its trash control. Clicking delete a second time removes it. The observed behavior is consistent with either:

1. two canonical edges being rendered on the same path and the first click removing only one of them, or
2. one canonical edge being removed correctly while another editor/projection path re-introduces or retains an equivalent edge.

The fix must establish the real source first, then enforce one canonical connection per exact endpoint/handle tuple without disturbing legitimate multi-handle connections or cluster projection behavior.

## Current code findings

### Canonical edge mutation

`WorkflowEditor.tsx` owns canonical `edges` through `useEdgesState`.

Structural edge changes are routed through:

```ts
const commitEdgeCandidate = useCallback((candidateEdges: Edge[]) => {
  ...
  setEdges(candidateEdges);
}, ...);
```

`onEdgesChange` also sends add/remove/replace changes through this boundary.

The custom trash button ultimately calls:

```ts
const removeEdge = useCallback(
  (edgeId: string) => commitEdgeCandidateRef.current(
    canonicalEdgesRef.current.filter((edge) => edge.id !== edgeId),
  ),
  [],
);
```

This removes exactly one edge identity, which is correct if edge IDs are unique and no equivalent duplicate exists.

### Manual connection creation

`onConnect` currently creates a new UUID for every accepted connection:

```ts
const id = `edge_${crypto.randomUUID()}`;
const newEdge: Edge = {
  id,
  ...params,
  type: "removable",
  data: { onRemoveEdge: () => removeEdge(id) },
};
commitEdgeCandidate(addEdge(newEdge, edges));
```

React Flow's `addEdge` provides some duplicate protection, but it is not a sufficient repository-wide invariant because other paths can create or restore edges without going through this call.

### Other edge-entry paths

At least these paths can populate canonical edges:

- manual `onConnect`;
- Loop-node creation, which directly appends with `setEdges((es) => [...es, newEdge])`;
- palette/batch node creation;
- workflow load/hydration;
- restore/import/history operations;
- React Flow structural `onEdgesChange`.

Therefore duplicate prevention should not live only inside `onConnect`.

### Cluster projection

`projectClusterGraph` emits one projected edge for each canonical edge that remains visible. It does not itself duplicate a canonical edge.

`reconcileClusterProjection` reconciles edges by edge ID and notices length changes. A normal canonical deletion should therefore remove the corresponding projected edge.

Do not change projection/reconciliation unless the diagnostic phase proves it is retaining a deleted edge.

---

## Desired invariant

Two edges are exact logical duplicates when all four connection coordinates match:

```
source
sourceHandle
target
targetHandle
```

Normalize missing handles consistently, e.g. `undefined` and `null` should compare as the same absent handle.

Do **not** deduplicate only by `source + target`.

These are potentially legitimate independent connections and must remain distinct:

```
A.output1 -> B.input
A.output2 -> B.input
```

Likewise, if the target handles differ, both edges must be retained.

The editor should preserve the first existing exact connection and reject/remove only later exact duplicates.

---

## Implementation plan

### 1. Add a focused regression test that reproduces the symptom before changing behavior

Create a small edge-invariant test near the existing workflow/cluster domain tests.

The test should prove the expected semantic contract independently of rendering:

- start with nodes A and B;
- add one edge from `A/output -> B/input`;
- attempt to add the same exact connection again with a different edge ID;
- canonical result must contain one logical connection;
- remove that remaining edge by ID;
- canonical result must contain zero matching connections.

Also add positive cases proving that distinct handles are not collapsed:

- `A/out-1 -> B/in`;
- `A/out-2 -> B/in`;
- both remain.

Add absent-handle normalization coverage:

- `sourceHandle: undefined` and `sourceHandle: null` should be treated consistently.

This test gives us a deterministic reproduction for the edge-data layer even if the UI race is hard to reproduce in Jest.

### 2. Add temporary development-only diagnostics around edge creation and deletion

Before changing projection code, instrument the canonical boundary enough to identify exactly what exists when the bug occurs.

Log only in development and include:

- operation: `connect`, `commit`, or `remove`;
- edge ID;
- source / sourceHandle;
- target / targetHandle;
- canonical edge count before and after;
- matching logical edge IDs for that connection key.

For deletion, log the requested ID and whether it existed in `canonicalEdgesRef.current`.

Example diagnostic shape:

```ts
{
  operation: "remove",
  edgeId,
  beforeCount,
  afterCount,
  logicalMatches: [...]
}
```

Do not leave noisy unconditional production logs. Either remove this instrumentation after confirmation or keep it behind `import.meta.env.DEV`.

Acceptance from this step:

- if two logical matches exist before the first delete, duplicate canonical creation is confirmed;
- if only one exists and it is gone after the first delete, investigate display/projection retention before applying dedupe changes.

### 3. Introduce one small pure helper for logical edge identity

Create a domain utility rather than scattering comparisons through the editor, for example:

`src/domain/workflowEdges.ts`

Suggested API:

```ts
export const getLogicalEdgeKey = (edge: Pick<Edge, ...>): string => ...
export const areSameLogicalConnection = (a, b): boolean => ...
export const dedupeLogicalEdges = (edges: readonly Edge[]): Edge[] => ...
```

Requirements:

- exact source match;
- exact target match;
- normalized source handle match;
- normalized target handle match;
- preserve original order;
- preserve the first edge object/ID;
- do not mutate inputs.

Avoid JSON stringification if a small tuple/key helper is clearer.

### 4. Enforce uniqueness at the canonical structural edge boundary

Update `commitEdgeCandidate` so all structural edge mutations pass through one normalization step before validation and state commit.

Conceptually:

```ts
const normalizedCandidateEdges = dedupeLogicalEdges(candidateEdges);
```

Then use `normalizedCandidateEdges` for:

- cluster validation;
- history commit;
- `setEdges`;
- the dissolve-cluster action.

This is the most important part of the fix because it protects every path that already uses `commitEdgeCandidate`, not only manual connection creation.

Keep behavior idempotent:

- if no duplicates exist, the helper should return the original array reference when practical;
- avoid creating new edge objects;
- do not rewrite IDs.

This keeps the recent drag/performance optimizations intact.

### 5. Route direct edge append paths through the same invariant

Review every direct structural `setEdges` call.

The Loop-node path currently does:

```ts
setEdges((es) => [...es, newEdge]);
```

Change structural creation paths so they go through the canonical commit boundary or the same pure normalization rule.

For the Loop path, prefer constructing the candidate from the latest canonical snapshot and calling `commitEdgeCandidateRef.current(...)` rather than introducing a second validation mechanism.

Do not route non-structural visual updates unnecessarily through this path.

Search the repo for:

- `setEdges(`;
- `addEdge(`;
- edge array concatenation;
- edge restore/import helpers.

Classify each occurrence as:

- canonical structural mutation -> must honor logical uniqueness;
- execution/runtime visual update -> leave alone if not document structure.

### 6. Harden manual `onConnect` without duplicating the central logic

Keep `onConnect` simple.

It may retain `addEdge`, but the canonical commit boundary should be authoritative.

Optionally make the UX cheaper by checking whether an exact logical connection already exists before generating a UUID. If it does, return immediately.

This is only an early exit optimization. It must not be the sole fix.

Do not show an error toast for a repeated identical drag unless product behavior explicitly wants one; silently retaining the existing edge is less disruptive.

### 7. Normalize duplicate edges during workflow hydration, carefully

Persisted workflows may already contain duplicates created before this fix. If we only prevent new duplicates, affected saved workflows will continue to require two deletes.

In `useWorkflowPersistence.loadWorkflow`:

1. restore edge callbacks exactly as today;
2. run exact logical dedupe after restoration;
3. preserve the first edge/ID;
4. keep valid different-handle parallel edges.

Important: the existing hydration comment says persisted endpoints/handles must not be repaired. Respect that rule.

This cleanup must **not** modify endpoints or handles. It only removes repeated entries with identical canonical connection coordinates.

Consider whether `markSaved` should use the normalized in-memory result. It should, so opening an affected workflow does not immediately appear dirty solely because runtime callbacks differ. A later explicit save can persist the cleaned document.

If product policy prefers not to silently normalize persisted data, an alternative is to keep duplicates loaded but make delete remove all exact logical duplicates. However, that leaves bad canonical state and is less robust. Prefer normalization if exact duplicates are considered invalid by design.

### 8. Decide deletion semantics after normalization

Once canonical uniqueness is guaranteed, `removeEdge(edgeId)` should continue deleting by ID.

Do **not** normally change deletion to delete by source/target tuple, because ID-based deletion is precise and safe.

For legacy duplicates that might enter from an unsupported path, normalization at commit/load should eliminate them before deletion is needed.

This keeps deletion semantics predictable:

```
one visible edge
-> one canonical edge
-> one delete
-> zero edges
```

### 9. Verify cluster behavior explicitly

Because `commitEdgeCandidate` performs cluster validation, add regression coverage confirming dedupe does not alter cluster semantics.

Test:

- internal cluster edge;
- boundary edge;
- repeated exact edge candidate;
- candidate normalization happens before validation;
- no unexpected cluster dissolve prompt;
- valid separate-handle boundary edges remain separate.

Do not modify `projectClusterGraph` or `reconcileClusterProjection` for this fix unless diagnostics demonstrate a projection-only failure.

### 10. Add a browser-level delete-once regression

Add or extend a Playwright workflow-editor fixture/test:

1. create two nodes;
2. connect them once;
3. assert one visible edge;
4. hover the edge;
5. click its trash button once;
6. assert no visible edge remains;
7. assert it does not reappear after a render/frame;
8. reconnect and ensure exactly one edge appears.

If practical, also exercise a workflow loaded from a fixture containing two exact duplicate edge records and verify normalization results in one visible edge that disappears with one delete.

This test is important because the user-visible bug involves React Flow rendering and callback wiring, not just the pure edge array.

---

## Minimal file scope

Expected production files:

1. `src/domain/workflowEdges.ts` — small pure identity/dedupe helper.
2. `src/pages/WorkflowEditor.tsx` — canonical commit enforcement, direct structural edge creation cleanup, optional development diagnostics.
3. `src/hooks/useWorkflowPersistence.ts` — normalize legacy exact duplicates during hydration.

Expected tests:

4. a focused unit test for `workflowEdges`.
5. targeted editor/browser regression coverage.

Do not change:

- `EdgeManager.tsx` unless diagnostics show the trash control is firing the wrong edge ID;
- `projection.ts`;
- `reconcileProjection.ts`;
- edge routing/math;
- cluster layout/drag behavior;
- workflow execution semantics.

---

## Edge cases to verify

### Same endpoints, same handles

```
A.out -> B.in
A.out -> B.in
```

Result: one canonical edge.

### Same endpoints, different source handles

```
A.out1 -> B.in
A.out2 -> B.in
```

Result: two canonical edges.

### Same endpoints, different target handles

Both remain.

### Missing handle values

`null` and `undefined` must be normalized consistently so serialized/hydrated edges do not bypass duplicate detection.

### Self-loop

Exact duplicate self-loop edges must dedupe; distinct handle pairs on the same node remain valid if the editor supports them.

### Cluster collapse/expand

Collapsing or expanding must not change canonical edge count.

### Undo/history

A duplicate connection attempt should not create a meaningless history entry if canonical state does not change.

A real edge deletion should create exactly one history snapshot.

### Save/reload

After cleanup and explicit save:

- persisted edge count matches canonical edge count;
- reload shows one connection;
- one delete removes it.

---

## History behavior refinement

Because `commitEdgeCandidate` currently calls `saveHistorySnapshot()` whenever validation passes, normalize before deciding whether a structural change actually occurred.

If the candidate differs only because it contained an exact duplicate that is removed by normalization and the resulting edge set is semantically identical to current edges, return without saving history or calling `setEdges`.

Use a lightweight comparison based on edge IDs/order after normalization; do not deep-compare render callbacks.

This prevents repeated connection drags from polluting undo history.

---

## Acceptance criteria

The fix is complete when all of the following hold:

- creating one connection produces exactly one canonical logical edge;
- repeated creation of the exact same source/handle -> target/handle connection does not add another canonical edge;
- one click on the trash control removes the connection completely;
- the edge does not reappear on the next render;
- workflows containing historical exact duplicates are safely normalized;
- different-handle parallel connections remain untouched;
- self-loops continue to work;
- cluster validation/collapse/expand behavior is unchanged;
- undo/redo does not gain no-op entries for rejected duplicates;
- save/reload preserves the corrected edge set;
- recent editor drag-performance changes remain untouched;
- TypeScript/build/tests pass.

---

## Recommended implementation order

1. Reproduce + add diagnostic logging.
2. Add pure logical edge identity/dedupe helper and unit tests.
3. Enforce it inside `commitEdgeCandidate`.
4. Move remaining direct structural edge-add paths under that boundary.
5. Normalize exact legacy duplicates during load.
6. Add no-op/history guard.
7. Add browser delete-once regression.
8. Run cluster, workflow-document, editor and build checks.
9. Remove temporary diagnostics if no longer needed.

## Expected root cause / confidence

The current deletion callback itself is structurally sound: it removes the requested canonical edge ID. Cluster projection also maps canonical edges one-for-one and reconciliation accounts for edge-list length changes.

Therefore the highest-probability failure is duplicate/equivalent canonical edge state entering through one of the multiple edge creation/hydration paths, especially a path that bypasses the single `onConnect -> addEdge` flow. The diagnostic step should confirm this before any projection code is touched.

If diagnostics instead show exactly one canonical edge before deletion and zero immediately after deletion while an edge remains on screen, stop the dedupe implementation at that point and investigate React Flow display-state synchronization. Do not mask a projection/render defect by deleting extra data.
