
# Review: Tool Toggle Implementation

## Verdict: Well implemented with 3 minor issues

The core architecture is solid. The toggle flows correctly through all layers:
- **NodeRouter.tsx**: Reads `__isTool` from `fieldState`/`values`, provides `handleToggleTool` via `useCallback`, swaps handles to `TOOL_HANDLE` when active.
- **NodeWrapper.tsx**: Wrench icon toggle (hidden until hover, highlighted when active), "TOOL" badge, proper `nodrag` class and `stopPropagation`.
- **useNodeExecution.ts**: Correctly includes `__isTool` nodes in `support_nodes` payload, sets `node_type: "sub"` for toggled nodes.
- **workflowExecutor.ts**: `isSubNode()` correctly treats `__isTool` nodes as sub-nodes (skipped in main execution).
- **fieldVisibility.ts**: `__isTool` in `systemKeys` ensures persistence.
- **Backend AIAgentExecutor.ts**: Logs toggled status, routes through existing `createToolFromNode`.

## Issues to Fix

### 1. Backend only logs, doesn't use toggled state meaningfully
`AIAgentExecutor.ts:284` reads `__isTool` but only uses it for a log message. The `createToolFromNode` and `getToolName` methods should check `__isTool` to avoid stripping a "Tool" suffix that doesn't exist on toggled main nodes (e.g., "Alpaca" vs "AlpacaTrade**Tool**"). Verify `getToolName()` handles main node names correctly when toggled.

**Action**: Review `getToolName()` — if it strips "Tool" suffix, toggled main nodes (which don't have that suffix) should pass through unchanged. Confirm this works or add a guard.

### 2. handleToggleTool has stale closure risk
The `useCallback` depends on `isTool` (derived from `data.fieldState?.__isTool`). When toggling, it uses `!isTool` which is correct. However, writing to both `values` AND `fieldState` simultaneously is redundant — `fieldState` is the canonical source (managed by `useNodeFieldState`), while `values` is the persisted snapshot. Writing to `fieldState` directly from `setNodes` bypasses the field state hook's own update mechanism, which could cause desync if `useNodeFieldState` overwrites it on next render.

**Action**: Only write to `values` in `handleToggleTool`. The field state hook should derive `__isTool` from values. Alternatively, if `fieldState` is authoritative at runtime, only write there and ensure persistence picks it up from `fieldState`.

### 3. No guard against toggling nodes that shouldn't be tools
Any node can be toggled to tool mode, including triggers (WebhookTrigger, Scheduler), backtest nodes, and AI Agent itself. An AI Agent toggled as a tool would create a recursive tool reference. Triggers as tools make no semantic sense.

**Action**: Add a guard — only allow toggling for nodes where `definition.node_type === "main"` and `definition.category` is not "Triggers" or "Backtest". Hide the wrench icon for ineligible nodes. This could be a simple prop like `canToggleTool` passed from NodeRouter based on the definition.

## No Issues Found With

- Handle swapping logic (clean TOOL_HANDLE constant, proper memoization deps)
- Support node filtering in `useNodeExecution.ts` (correctly checks both `values` and `fieldState`)
- Persistence via `systemKeys` in `fieldVisibility.ts`
- UI/UX of the toggle (hover reveal, active highlight, badge)
- `isSubNode` in `workflowExecutor.ts` (clean OR logic)
