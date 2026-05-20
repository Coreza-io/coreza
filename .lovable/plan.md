# Wire pre-generated `workflowId` end-to-end to BaseNode / useNodeExecution

## Why it's currently `undefined` at the node

The UUID is now generated correctly at editor mount, but it never reaches the nodes. Trace:

```text
WorkflowEditor
  └─ workflowId = "uuid-A"            ✅ generated
  └─ nodeTypes = useMemo(() => ({ ...baseNodeTypes, Loop: ... }))
                                       ❌ does NOT close over workflowId
       └─ ReactFlow renders <NodeRouter data={...} selected={...} />
            └─ <BaseNode data={data} selected={selected} readOnly={data.readOnly}>
                                       ❌ no workflowId prop passed
                 └─ const workflowId = propWorkflowId ?? useParams().id
                                       ❌ falls back to "new"  →  backend 400
```

`baseNodeTypes` (line 146) is built once at module top-level by mapping every node key to the raw `NodeRouter` component, so the running `workflowId` state never enters the closure.

## Fix: thread `workflowId` through nodeTypes → NodeRouter → BaseNode

### 1. `src/pages/WorkflowEditor.tsx`

Rebuild the `nodeTypes` memo so every entry is a wrapper that injects the live `workflowId` as a prop, and add `workflowId` to the dep array so a remount-safe identity is produced once per workflow:

```ts
const nodeTypes = useMemo(() => {
  const wrap = (Comp: any) => (props: any) =>
    <Comp {...props} workflowId={workflowId} />;

  const wrappedBase = Object.fromEntries(
    Object.entries(baseNodeTypes).map(([key, Comp]) => [key, wrap(Comp)])
  );

  return {
    ...wrappedBase,
    Loop: (props: any) => (
      <LoopNode
        {...props}
        workflowId={workflowId}
        data={{ ...(props.data as LoopNodeData), onAddNode: handleAddNode }}
      />
    ),
  };
}, [handleAddNode, workflowId]);
```

Note: changing `nodeTypes` identity makes ReactFlow re-register node types. Because `workflowId` is now stable for the entire editor session (generated once in `useState`), this memo only changes when `workflowId` actually changes (new → loaded), which is acceptable.

### 2. `src/components/nodes/NodeRouter.tsx`

Accept and forward `workflowId`:

```tsx
const NodeRouter = ({ data, selected, workflowId }: {
  data: any; selected: boolean; workflowId?: string;
}) => {
  ...
  return (
    <BaseNode
      data={data}
      selected={selected}
      readOnly={data.readOnly}
      workflowId={workflowId}
    >
      {(renderProps) => ( ... )}
    </BaseNode>
  );
};
```

(Also forward to `LoopNode` if it renders BaseNode internally.)

### 3. `src/components/nodes/BaseNode.tsx`

No change needed — it already uses `propWorkflowId ?? routeWorkflowId` and passes `workflowId` into `useNodeExecution` (line ~189). Once NodeRouter sends the prop, `useNodeExecution` receives the real UUID and the backend payload stops being `workflowId: "new"`.

### 4. `src/hooks/useNodeExecution.ts`

Verify it reads `workflowId` from its options and includes it in every outbound request body (it already does — confirm no fallback to `useParams()` inside the hook). No code change expected; this is a verification step.

## End-to-end flow after fix

```text
WorkflowEditor
  └─ workflowId = "uuid-A"
       └─ nodeTypes memo (closure: workflowId)
            └─ <NodeRouterWrapper workflowId="uuid-A" data=... selected=... />
                 └─ <NodeRouter workflowId="uuid-A" .../>
                      └─ <BaseNode workflowId="uuid-A" .../>
                           └─ useNodeExecution({ workflowId: "uuid-A", ... })
                                └─ POST /stream/alpaca/register
                                   body: { workflowId: "uuid-A", nodeId, ... }
                                   →  200 OK
```

## Out of scope

- No backend changes.
- No change to save logic (already covered by previous plan: insert with pre-generated id, navigate on first save).
- No change to `useParams` fallback in BaseNode — kept as a safety net for any node rendered outside the editor.

## Verification

1. Add a `console.log("workflowId in BaseNode:", workflowId)` temporarily in BaseNode → open `/dashboard/workflow/new` → drop AlpacaStreamData → log shows the UUID, not `"new"` or `undefined`.
2. Click Execute → Network tab: `POST /stream/alpaca/register` body has `workflowId: "<uuid>"`. Backend returns 200.
3. Refresh after save → URL is `/dashboard/workflow/<uuid>`, same UUID flows down, execute still works.
4. Open an existing workflow at `/dashboard/workflow/<uuid>` → BaseNode receives the URL UUID via prop (not fallback), behavior unchanged.
