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

### Fix 2 — persist pinned output across reloads, saves, export/import (confirmed: yes)

Pinned output becomes part of the saved workflow so a reopened workflow keeps the hardcoded value.

1. Save path — `src/hooks/useWorkflowPersistence.ts` › `serializeNodes`
   - Add `pinnedOutput` to the serialized node, alongside `values`, only when it is defined and non-null.
   - Guard the payload size: run the value through a helper `safePinnedOutput(value)` that `JSON.stringify`s it and drops it (with a console warning) when it exceeds ~256 KB, so a huge stream/backtest payload cannot bloat the workflow row. Values that fail to stringify (circular refs) are dropped the same way.

2. Load path — `src/hooks/useWorkflowPersistence.ts` › restore mapping
   - Read `(node as any).pinnedOutput ?? node.data?.pinnedOutput` and set both `pinnedOutput` and `output` on the restored `node.data`, so the panel shows the pinned value immediately and `useNodeOutput`'s initial `overrideOutput` (which already reads `data.pinnedOutput`) picks it up on mount.

3. Stale-state exception — `useNodeOutput` initial state
   - The current initializer downgrades `listening`/`streaming` statuses to `{ status: "pending" }`. Skip that downgrade when `data.pinnedOutput` is present, so a pinned value is never rewritten to pending on reload.

4. Export/import — `src/utils/workflowExport.ts`
   - Add `pinnedOutput` to the exported node shape (same size guard) and restore it on import, so pinned values survive file round-trips. Per the existing import rules, node IDs are still regenerated; `pinnedOutput` travels with its node.

5. Unsaved-changes detection
   - `computeHash` hashes whole nodes, so pinning/unpinning already marks the workflow dirty — no change needed, verified by reading the hook.

6. Backend/DB
   - No migration needed: workflow nodes are stored as JSONB, so the extra key is additive. Existing workflows without the key load unchanged.

## Technical notes

- Whitelist policy: node persistence intentionally saves only known keys; this plan adds exactly one new key (`pinnedOutput`) at the node level, not inside `values`, so field normalization rules are untouched.
- Clearing: unpinning sets `data.pinnedOutput = undefined`, which drops it from the next serialization — no explicit delete path needed.

## Verification

- Pin an edited output, save, reload the workflow: panel shows the pinned value and the pin toggle is active.
- Execute the pinned node after reload: no network request, output unchanged.
- Run the full workflow: downstream node input shows the pinned value.
- Unpin, save, reload: node returns to normal execution.
- Export a workflow with a pinned node and re-import it: pinned value preserved.

