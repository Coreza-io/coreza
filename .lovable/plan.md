# Fix: Plug icons misaligned in execution history view

## Problem

In the editor, each edge has a clean plug indicator (`ConnectedSwitchIcon`) sitting flush against the node where the cord meets the handle. In the execution history view the same nodes render a tiny offset `FemalePlugIcon` (and the male plug stays visible on outputs), so the cord visually ends in empty space and the row of plug icons looks misaligned.

## Root cause

`NodeRouter` reads the live edge list via `useStableNodes()` and passes it to `NodeWrapper`, which decides per handle:

```ts
const isConnected = edges.some(edge =>
  isInputHandle
    ? edge.target === nodeId && edge.targetHandle === h.id
    : edge.source === nodeId && edge.sourceHandle === h.id,
);
```

- Connected input handle -> `ConnectedSwitchIcon` (the polished, aligned plug).
- Connected output handle -> icon hidden (cord takes over).
- Otherwise -> raw `MalePlugIcon` / `FemalePlugIcon`.

`useStableNodes()` is implemented via `useReactFlow()` inside `StableNodeProvider`, which is mounted once at the top of `WorkflowEditor` — outside the inner `<ReactFlowProvider key={execution.id}>` that `ExecutionDetailView` creates. So inside the execution canvas, `getEdges()` returns the **editor's** edges, not the execution snapshot's edges. For execution nodes (same IDs as editor in the lucky case, different in others) the `isConnected` check ends up false for the relevant handles, so the wrong icons render and the cord appears to terminate before the plug.

## Fix

Scope a `StableNodeProvider` to the execution canvas so `useStableNodes()` resolves to the inner React Flow instance and sees the execution snapshot's nodes/edges.

### `src/components/workflow/ExecutionDetailView.tsx`

- Import `StableNodeProvider` from `@/contexts/StableNodeContext`.
- Inside the existing `<ReactFlowProvider key={execution.id}>`, wrap `<StaticExecutionStoreProvider>` and `<ReactFlow>` with `<StableNodeProvider>`. The order becomes:

  ```
  ReactFlowProvider
    StableNodeProvider          // new — binds to inner React Flow instance
      StaticExecutionStoreProvider
        ReactFlow ...
  ```

That single change makes `NodeRouter` / `NodeWrapper` read the execution edges in this subtree, so the `isConnected` branch fires and the same `ConnectedSwitchIcon` (and hidden male plug on connected outputs) renders just like the editor.

No changes to `NodeWrapper`, `NodeRouter`, or `StableNodeContext` are needed.

## Verification

- Open execution history for any workflow with multiple connected nodes.
- Plug icons on connected handles now match the editor exactly: aligned `ConnectedSwitchIcon` at input side, no stray male plug on connected outputs.
- Disconnected handles (if any) still show the regular female/male plug at the correct edge.
- Editor view is unchanged.
