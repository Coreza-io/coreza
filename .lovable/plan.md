# Drag-lag fixes: review findings and corrections

## Verdict

The fixes are mostly correct but not fully accepted: one real correctness risk, one documentation defect, and missing tests and measurements.

Correct as implemented:
- Edges: all three `useNodes()` calls were replaced. Each line now reads only its source and target from `nodeLookup`, using explicit equality and O(1) lookup, and the routing math is unchanged. Self-loops and missing endpoints still fall back as before.
- Insertion guard: `onMouseMove` returns before hit-testing when a node, selection, cluster-move or connection drag is active. The flags are synchronous refs, cleared on drag end, workflow switch and unmount. Click/drop still re-resolves placement.
- Projection: reconciliation reads the last committed result, is written in a layout effect, is ignored after a session change, and does not mutate inputs. Default cluster actions are now stable constants.
- Checks: type check, the preview build and 22 cluster tests pass.

## Issues to fix

1. **Risk: visible canonical nodes can be swapped for older objects.** `reuseItems` returns a previous node whenever it looks equivalent to three levels deep, including nodes passed through unchanged from the canonical graph. If the editor replaces a node with a new reference whose changes are deeper than that comparison, React Flow keeps the old object and can miss the update. This breaks the plan rule "visible canonical nodes keep canonical references".
   - Fix: when the freshly projected item is the exact canonical node or edge object, always use it. Reuse earlier objects only for items the projection itself creates: hidden runtime hosts, compact cards and rewritten boundary edges.
   - For runtime hosts, reuse a previous host only when it wrapped the same canonical node reference.

2. **The new `AGENTS.md` rule was glued onto the previous line** because the file had no trailing newline. Put it on its own line.

3. **Missing tests**, required by the plan:
   - Edges: unrelated node movement leaves the endpoint selector result unchanged; moving or resizing a source/target changes it; a missing endpoint returns no record.
   - Insertion guard: no hit-testing during each drag type; it resumes after stop, connection cancel and workflow switch.
   - Projection: a canonical node replaced with deeper-only changes is still passed through (regression test for issue 1); a host is recreated when its canonical node changes.

4. **Not measured:** the 20/100/300-node browser drag baseline and before/after frame timings (plan steps 1 and 7) were not done. Add a deterministic fixture and report the median and p95 frame interval, and say plainly if the speed-up cannot be measured in the sandbox.

## Technical details

- In `src/domain/clusters/reconcileProjection.ts`, pass the canonical node and edge ID maps into `reconcileClusterProjection`. When `next === canonicalById.get(id)`, keep `next`. Otherwise, reuse `prior` only if it is equivalent and both objects carry the same canonical `data` reference.
- Export `toBounds`/`sameBounds` (or a pure selector factory) from `EdgeManager` so they can be unit-tested without mounting React Flow, and add one React Flow-mounted render-count check.
- Extract the `onMouseMove` guard condition into a small pure helper so it can be tested.
- Verification: focused Jest suites, `tsgo`, lint on changed files, `git diff --check`, and the build log.
