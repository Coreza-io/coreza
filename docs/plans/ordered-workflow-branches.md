# Ordered workflow branches

## Goal

Add an opt-in branch order for a regular node with multiple connections from one output. In the reported workflow, `Compute46` runs `Edit Fields7 → Edit Fields8` before `Edit Fields9 → Edit Fields10`. `Compute47` becomes ready after both incoming branches complete. The existing connections remain in place, so `Edit Fields9` still receives its direct input from `Compute46`.

## Implementation

1. **Save branch order on the existing edges.** Add one optional integer, `edge.data.branchOrder`. In `src/pages/WorkflowEditor.tsx`, add an action at the fork to save top-to-bottom order using the target nodes' canvas Y positions and the current edge order for ties. Apply the change to the canonical edges in one undoable edit. Show the saved numbers and provide a way to clear them. Moving nodes leaves the order intact. `src/domain/workflowDocument.ts` already serializes edge data. Carry the field through the frontend export/import and any execution edge projections that reconstruct records. Extend the backend `WorkflowEdge` type in `coreza-backend/src/nodes/types.ts`. Store the setting in the existing workflow JSON.
2. **Share one ready-node ordering rule.** Build a small pure helper for the editor and backend. For the initial version, support separate linear execution paths from the same output handle up to a shared join. Each path gets its first edge's saved priority. Exclude the fork and join from the priority map. Require a complete, unique set of priorities on the sibling edges and validate the path shape when loading the run. Unsupported structures, including nested forks, conditional routing, or loop feedback inside an ordered region, stay on FIFO. The editor should allow ordering only on supported forks. When the FIFO head belongs to an ordered fork, select the earliest ready item in the highest-priority branch of that same fork and runtime iteration. Use FIFO for ties and unrelated work. Existing dependency checks still decide which nodes are ready. For graphs without branch settings, keep the existing queue path.
3. **Apply the rule at the three scheduling points.** In `src/utils/workflowExecutor.ts`, apply it when editor Run All selects its next ready node. In `coreza-backend/src/engine/executionRuntime.ts` and `nodeQueueManager.ts`, use it when the live or dynamic backtest runtime dequeues ready work. In `coreza-backend/src/engine/graphRuntime.ts`, apply it when the topological sort selects a zero-indegree node for `backtest/compiled/compiler.ts`. Compute branch metadata once per graph and keep the compiled VM's per-bar loop as it is.

## Execution semantics

The existing routing and join input rules still apply. In this example the lower branch finishes last, so the join receives its direct input under the current last-arrival behavior. Expressions that need a specific upstream result can reference that node by name. Keep cancellation, failure handling, loop bookkeeping, and individual node and cluster actions on their current paths.

Scope is limited to the edge setting, ready-node ordering, and the existing persistence paths. Testing is outside this plan.
