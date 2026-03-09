

# Bug: Node Display Name Not Updating After Rename

## Root Cause

In `NodeRouter.tsx` line 331:
```typescript
label={data.label || renderProps.displayName}
```

When a node is created (in both `WorkflowEditor.tsx` and `useWorkflowState.ts`), `data.label` is set to `nodeDefinition.name` (e.g., "EMA"). When the user renames the node, `useNodeRenaming` correctly updates `data.displayName` to the new name, but `data.label` is **never updated** and remains the original name.

Since `data.label` is always truthy, it takes priority over `renderProps.displayName` (which correctly resolves `data.displayName`). The renamed value is ignored until a page refresh reconstructs the node data.

## Fix

| File | Change |
|---|---|
| `src/components/nodes/NodeRouter.tsx` (line 331) | Change `label={data.label \|\| renderProps.displayName}` to `label={renderProps.displayName}` |

`renderProps.displayName` already handles the full fallback chain correctly: `data.displayName` → `getDisplayName()` (auto-dedup based on `definition.name`). The `data.label` override is redundant and causes the stale name bug.

No other files need changes. The rename hook (`useNodeRenaming`) is already correct — it sets `data.displayName` properly.

