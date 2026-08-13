# Pinned / edited node output should win on execution

Today you can click Edit on the Output panel, change the JSON, and pin it — but executing the node can still replace or bypass that value. Reviewing the flow end to end, four places break the promise:

1. `useNodeExecution` still performs the real request and only applies the pinned value at the very end of the success path.
2. The error path (`catch`) ignores the pin completely and overwrites the panel with an error output.
3. The streaming-trigger path returns early, before the pinned value is ever applied.
4. Saving an edit updates the local panel and `data.output`, but never the execution store or the React Flow node, so downstream nodes and full workflow runs keep consuming the old value.

## Intended behaviour

- Editing the output saves it and pins it (as today).
- While pinned, clicking Execute does not call the backend at all: the node immediately reports the pinned value as its output, marks itself executed, and passes it to downstream nodes.
- Errors, streaming and listening flows cannot overwrite a pinned output.
- Unpinning restores the last real execution output and re-enables normal execution.
- A pinned value is also used when the node runs as part of a full workflow run (manual run in the editor).

## Technical changes

1. `src/hooks/useNodeOutput.ts`
   - `handlePanelSave`: besides setting the override, write the value to `executionStore.setNodeData(nodeId, { output })` and keep `data.output` in sync so downstream input panels and the executor see it.
   - `handlePanelPinToggle`: on unpin, restore from the execution store (fall back to `data.output`).
   - Expose the pinned value explicitly (`pinnedOutput`) instead of relying on callers deriving it from `displayedData`.

2. `src/hooks/useNodeExecution.ts`
   - At the top of `handleSubmit`, short-circuit when `overrideOutput !== null`: skip payload build, validation and the network/listening branches; set `lastOutput`, `data.output`, execution-store entry and the React Flow node data to the pinned value, clear `isSending`, and return. This covers the error and streaming-trigger paths in one place.
   - In the `catch` block, keep the pinned value if one exists rather than writing `errOutput`.

3. `src/components/nodes/BaseNode.tsx`
   - Pass `outputHook.pinnedOutput` into `useNodeExecution` as `overrideOutput` (no behaviour change, just uses the explicit field).

4. Full workflow runs — `src/utils/workflowExecutor.ts`
   - Before executing a node, check the node's pinned output (surfaced via node data, e.g. `data.pinnedOutput`, written by `useNodeOutput`) and, when present, use it as the node result without dispatching the auto-execute event.
   - `BaseNode`/`useNodeOutput` writes `pinnedOutput` onto the node data on pin/save and clears it on unpin so the executor can read it.

No backend changes; this is entirely editor/presentation behaviour.
