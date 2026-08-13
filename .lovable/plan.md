# Pinned Output Review — Result and Remaining Gaps

## What is correctly implemented

- `src/hooks/useNodeOutput.ts` exposes `pinnedOutput` and `syncPinnedOutput` writes the pinned value into node data, the execution store, and React Flow node data. Unpinning clears `pinnedOutput` and falls back to the store output.
- `src/hooks/useNodeExecution.ts` short-circuits `handleSubmit` when a pinned value exists: no network call, output set to the pinned value, store and node data updated. Errors cannot overwrite a pinned output (guard in `catch`). The success path also prefers `overrideOutput`.
- `src/utils/workflowExecutor.ts` `executeNode` returns the pinned value and writes it to the node store before any streaming or auto-execute dispatch, so full workflow runs and downstream nodes consume the pinned value.
- `src/components/nodes/BaseNode.tsx` passes `outputHook.pinnedOutput` as `overrideOutput` into the execution hook, closing the loop.
- Auto-execution (`useNodeAutoExecution`) routes through `handleSubmit`, so it inherits the short-circuit.

Verdict: the core requirement (pin/edit output -> executing the node returns the hardcoded value) is correctly implemented.

## Remaining gaps

1. Live socket updates overwrite the pinned value in the execution store.
   In `src/contexts/ExecutionStoreContext.tsx`, `webhook_event`, `webhook_error`, and streaming handlers call `setNodeData(nodeId, { output: ... })` unconditionally. The node's own panel still shows the pinned value (display uses `overrideOutput`), but downstream input panels and `workflowExecutor` reads of the store can see the socket payload instead of the pinned value.

2. Pinned output does not survive save/reload.
   `serializeNodes` in `src/hooks/useWorkflowPersistence.ts` only persists `values`, so a pinned output is lost on reload. If pinning is meant to be a session-only debug aid this is fine; if it should persist it needs to be serialized and restored.

## Proposed fixes

### Fix 1 — protect pinned nodes from socket writes (recommended)

- Add a pinned registry to the execution store: `setPinned(nodeId, value | null)` and an internal `pinnedNodeIds` set.
- In `ExecutionStoreContext`, make `setNodeData` ignore any `output` key for a node that is currently pinned (non-output keys such as `isListening` still apply).
- In `useNodeOutput.syncPinnedOutput`, call `executionStore.setPinned(nodeId, value)` alongside the existing writes so pin/unpin registers and de-registers.

### Fix 2 — persist pinned output (only if desired)

- In `serializeNodes`, add `pinnedOutput: n.data.pinnedOutput` when defined.
- On restore in `useWorkflowPersistence`, map `pinnedOutput` back onto `node.data` so `useNodeOutput`'s initial `overrideOutput` picks it up (it already reads `data.pinnedOutput`).

## Question before implementing

Should pinned output persist across reloads and workflow saves, or stay a session-only debugging override? Fix 1 is worth doing either way.
