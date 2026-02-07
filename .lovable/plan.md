
# Plan: Fix Critical Performance Issues in Workflow Editor

## Problem Summary

The workflow editor is extremely slow and producing errors because every node component re-renders on every position change. This creates a cascade of re-renders that overwhelms React.

**Error**: `"The provided callback is no longer runnable"` at `buildUpstreamIndex`
**Symptom**: Editor is too slow to move nodes

## Root Cause

The `useNodes()` hook is called in 9+ places across the codebase. According to React Flow documentation:

> "Components that use this hook will re-render whenever any node changes, including when a node is selected or moved."

With 10 nodes, each using ~6 hooks with `useNodes()`, a single drag operation triggers 60+ re-renders per frame.

---

## Current Architecture (Problematic)

```text
User drags node
    │
    ▼
onNodesChange fires
    │
    ▼
useNodes() returns new array reference
    │
    ├──► BaseNode re-renders (calls useNodes)
    │       ├──► useNodeFieldState re-renders (calls useNodes)
    │       ├──► useNodeRenaming re-renders (calls useNodes)
    │       ├──► useNodeExecution re-renders (calls useNodes)
    │       ├──► useNodeReferences re-renders (calls useNodes)
    │       └──► useNodeAutoExecution re-renders (calls useNodes)
    │
    ├──► NodeRouter re-renders (calls useNodes)
    │
    ├──► LoopNode re-renders (calls useNodes)
    │
    └──► EdgeManager re-renders (calls useNodes)
    
    Result: N × 6 re-renders per drag tick = O(N²) performance
```

---

## Solution Overview

Replace direct `useNodes()` calls with targeted selectors and pass data via props where possible.

| Strategy | Impact | Files Affected |
|----------|--------|----------------|
| Use `useStore` with selectors | High | All node hooks |
| Pass nodes/edges via props | Medium | BaseNode, hooks |
| Memoize expensive computations | Medium | getAllUpstreamNodes |
| Defer non-critical updates | Low | Field sync effects |

---

## Implementation Plan

### Phase 1: Remove useNodes from BaseNode and Child Hooks

**Goal**: BaseNode already receives `nodes` and `edges` from parent - stop re-fetching them internally.

#### 1.1 Modify `BaseNode.tsx`

- Remove direct `useNodes()` and `useEdges()` calls
- Accept `nodes` and `edges` as props (already available from parent NodeRouter/LoopNode)

**Before** (line 100-102):
```typescript
const nodeId = useNodeId();
const nodes = useNodes();
const edges = useEdges();
```

**After**:
```typescript
const nodeId = useNodeId();
// nodes and edges received via props or context
```

#### 1.2 Create a Stable Node Context

Create a context that provides nodes/edges without triggering re-renders on position changes:

**New file**: `src/contexts/StableNodeContext.tsx`

```typescript
import { createContext, useContext, useRef, useMemo } from 'react';
import { useStore } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';

interface StableNodeContextValue {
  getNodes: () => Node[];
  getEdges: () => Edge[];
  getNodeById: (id: string) => Node | undefined;
}

const StableNodeContext = createContext<StableNodeContextValue | null>(null);

export function StableNodeProvider({ children }: { children: React.ReactNode }) {
  // Use refs to hold current values without causing re-renders
  const storeApi = useStore((state) => state);
  
  const value = useMemo(() => ({
    getNodes: () => storeApi.getNodes(),
    getEdges: () => storeApi.edges,
    getNodeById: (id: string) => storeApi.getNodes().find(n => n.id === id),
  }), [storeApi]);
  
  return (
    <StableNodeContext.Provider value={value}>
      {children}
    </StableNodeContext.Provider>
  );
}

export function useStableNodes() {
  const ctx = useContext(StableNodeContext);
  if (!ctx) throw new Error('useStableNodes must be used within StableNodeProvider');
  return ctx;
}
```

---

### Phase 2: Fix Individual Hooks

Each hook currently calls `useNodes()` independently, causing redundant subscriptions.

#### 2.1 `useNodeFieldState.ts` (line 43)

**Problem**: Uses `useNodes()` but only needs `setNodes` for updates.

**Fix**: Remove `useNodes()`, keep only `useReactFlow().setNodes`.

```typescript
// REMOVE
const nodes = useNodes();

// KEEP - this is efficient, doesn't subscribe to changes
const { setNodes } = useReactFlow();
```

#### 2.2 `useNodeRenaming.ts` (line 44-45)

**Problem**: Uses `useNodes()` to check for duplicate names during rename.

**Fix**: Only read nodes when actually renaming (inside the finishEditing callback), not on every render.

```typescript
// Before (subscribes to all changes)
const nodes = useNodes();

// After (only reads when needed)
const { getNodes, setNodes, setEdges } = useReactFlow();

const finishEditing = useCallback((save = true) => {
  if (save && editingName.trim()) {
    const nodes = getNodes(); // Read only when needed
    // ... validation logic
  }
}, [getNodes, ...]);
```

#### 2.3 `useNodeAutoExecution.ts` (line 38)

**Problem**: Uses `useNodes()` but likely only needs specific node data.

**Fix**: Use `useNodesData` with specific node IDs if available, or defer to callback-time reads.

#### 2.4 `useNodeExecution.ts` (line 93-94)

**Problem**: Uses both `useNodes()` and `useEdges()`.

**Fix**: 
- For `buildPayload`: Read nodes/edges inside the callback using `getNodes()`/`getEdges()`
- This prevents subscriptions while still having access to current data

```typescript
// Before
const nodes = useNodes();
const edges = useEdges();

// After
const { getNodes, getEdges, setNodes } = useReactFlow();

const buildPayload = useCallback((fieldState, selectedInputData) => {
  const nodes = getNodes(); // Read at execution time
  const edges = getEdges();
  // ... rest of logic
}, [getNodes, getEdges, ...]);
```

#### 2.5 `useNodeReferences.ts` (line 55)

**Problem**: Uses `useNodes()` for drag/drop reference resolution.

**Fix**: Similar pattern - use `getNodes()` inside callbacks.

---

### Phase 3: Fix NodeRouter and LoopNode

These components are wrapped in React.memo but still use `useNodes()` internally.

#### 3.1 `NodeRouter.tsx` (line 34-35)

**Current**:
```typescript
const nodes = useNodes();
const edges = useEdges();
```

**Fix**: Pass nodes/edges as props from WorkflowCanvas, or use stable context.

#### 3.2 `LoopNode.tsx` (line 32-33)

**Same fix**: Accept nodes/edges via props instead of hooks.

---

### Phase 4: Fix EdgeManager

#### 4.1 Lines 513 and 827

**Problem**: Edge components use `useNodes()` to access node positions.

**Fix**: Use `useInternalNode()` for single-node lookups (documented as more efficient).

```typescript
// Before
const nodes = useNodes();
const sourceNode = nodes.find(n => n.id === source);

// After - single node lookup without subscribing to all changes
import { useInternalNode } from '@xyflow/react';
const sourceNode = useInternalNode(source);
```

---

### Phase 5: Optimize getAllUpstreamNodes

The current implementation rebuilds indexes on every call. Since this is called frequently during renders, cache the result.

#### 5.1 Add Memoization Layer

**File**: `src/utils/getAllUpstreamNodes.ts`

```typescript
// Add a simple cache based on edges array identity
let cachedEdges: Edge[] | null = null;
let cachedNodes: Node[] | null = null;
let cachedIndex: UpstreamIndex | null = null;

function getOrBuildIndex(edges: Edge[], nodes: Node[]): UpstreamIndex {
  // Only rebuild if arrays changed (reference equality)
  if (edges === cachedEdges && nodes === cachedNodes && cachedIndex) {
    return cachedIndex;
  }
  
  cachedEdges = edges;
  cachedNodes = nodes;
  cachedIndex = buildUpstreamIndex(edges, nodes);
  return cachedIndex;
}
```

---

### Phase 6: Debounce Field State Sync

#### 6.1 `useNodeFieldState.ts` Effect (lines 136-167)

**Problem**: Syncs field state to node on every change, triggering more re-renders.

**Fix**: Add debouncing to batch rapid updates.

```typescript
useEffect(() => {
  if (readOnly || !nodeId || !hasInitialized.current) return;
  
  const timeoutId = setTimeout(() => {
    setNodes((nds) => /* sync logic */);
  }, 50); // 50ms debounce
  
  return () => clearTimeout(timeoutId);
}, [fieldState, nodeId, setNodes, readOnly]);
```

---

## Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `src/contexts/StableNodeContext.tsx` | Create | New context for stable node access |
| `src/components/nodes/BaseNode.tsx` | High | Remove useNodes/useEdges, use context |
| `src/hooks/useNodeFieldState.ts` | High | Remove useNodes, add debounce |
| `src/hooks/useNodeRenaming.ts` | High | Use getNodes() in callback only |
| `src/hooks/useNodeExecution.ts` | High | Use getNodes/getEdges in callbacks |
| `src/hooks/useNodeReferences.ts` | High | Use getNodes() in callbacks |
| `src/hooks/useNodeAutoExecution.ts` | Medium | Optimize node access pattern |
| `src/components/nodes/NodeRouter.tsx` | Medium | Use context or props for nodes |
| `src/components/workflow/LoopNode.tsx` | Medium | Use context or props for nodes |
| `src/components/workflow/EdgeManager.tsx` | Medium | Use useInternalNode instead |
| `src/utils/getAllUpstreamNodes.ts` | Low | Add index caching |
| `src/components/workflow/WorkflowCanvas.tsx` | Low | Wrap with StableNodeProvider |

---

## Expected Improvements

| Metric | Before | After |
|--------|--------|-------|
| Re-renders per drag tick | N × 6 = 60+ (for 10 nodes) | 1-2 |
| getAllUpstreamNodes calls | 60+ per tick | 1 per tick (cached) |
| Error rate | Frequent "callback not runnable" | None |
| Drag smoothness | Slideshow | 60 FPS |

---

## Verification Steps

After implementation:

1. Open React DevTools Profiler
2. Drag a node around the canvas
3. Verify only the dragged node component re-renders
4. Check console for no "callback not runnable" errors
5. Test with 20+ nodes to ensure scalability

---

## Technical Notes

**Why the error occurs**: When React batches too many state updates, components unmount/remount rapidly. The `useNodes()` subscription callback from a previous render becomes stale ("no longer runnable") when the component re-renders before the callback completes.

**Why useStore with selectors works**: Zustand's selector mechanism only triggers re-renders when the selected slice of state changes. Selecting `state.getNodes` (a function reference) instead of `state.nodes` (the array) avoids position-change subscriptions.

**React Flow best practice**: The official docs recommend using `useReactFlow().getNodes()` for imperative reads and `useStore` with selectors for reactive subscriptions that need specific data.
