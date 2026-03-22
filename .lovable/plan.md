

# Fix: Hide Source Handle's Male Plug Icon During Connection Drag

## Problem

When dragging a connection from a source handle, two male plug icons are visible:
1. The original male icon rendered on the source handle (in `NodeWrapper`)
2. The temporary dragging male icon rendered by `PlugConnectionLine`

This creates a visual duplicate.

## Solution

Use React Flow's `onConnectStart` / `onConnectEnd` callbacks to track which handle is currently being dragged from. Pass this state to `NodeWrapper` via a React context, and hide the male plug icon on that specific handle during the drag.

## Changes

### 1. Create a connection-drag context

**New file: `src/contexts/ConnectionDragContext.tsx`**

A small context that holds `{ nodeId, handleId, handleType }` for the currently dragging connection, or `null` when idle.

```typescript
export interface DragSource {
  nodeId: string | null;
  handleId: string | null;
  handleType: string | null;
}

export const ConnectionDragContext = createContext<DragSource>({
  nodeId: null, handleId: null, handleType: null,
});
```

### 2. Add `onConnectStart` / `onConnectEnd` to ReactFlow instances

**Files: `src/pages/WorkflowEditor.tsx` and `src/components/workflow/WorkflowCanvas.tsx`**

- Add `useState` for `dragSource`
- Pass `onConnectStart` callback that sets `{ nodeId, handleId, handleType }` from the params
- Pass `onConnectEnd` callback that resets to `null`
- Wrap the `<ReactFlow>` with `<ConnectionDragContext.Provider value={dragSource}>`

### 3. Consume context in NodeWrapper to hide the male icon

**File: `src/utils/NodeWrapper.tsx`**

- Import and `useContext(ConnectionDragContext)`
- In the handle rendering loop (around line 377-381), add a check:

```typescript
const isDraggingFromThis =
  dragSource.handleType === "source" &&
  dragSource.nodeId === nodeId &&
  dragSource.handleId === h.id;

// For output handles: hide if connected OR if currently dragging from this handle
handleIcon = (isConnected || isDraggingFromThis) ? null : (
  <MalePlugIcon size={20} style={iconStyle} />
);
```

## Files Changed

| File | Change |
|---|---|
| `src/contexts/ConnectionDragContext.tsx` | New context for tracking active connection drag source |
| `src/pages/WorkflowEditor.tsx` | Add `onConnectStart`/`onConnectEnd`, wrap ReactFlow with provider |
| `src/components/workflow/WorkflowCanvas.tsx` | Same — add drag state and provider |
| `src/utils/NodeWrapper.tsx` | Consume context, hide male icon on the dragging handle |

