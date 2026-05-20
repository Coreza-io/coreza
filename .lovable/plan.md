# Fix: workflowId undefined on /workflow/new stream execution

## Diagnosis from scratch

`const { id: workflowId } = useParams()` is `undefined` on `/dashboard/workflow/new` by design.

The router has two workflow editor routes:

```text
/dashboard/workflow/new       -> no :id param
/dashboard/workflow/:id       -> id param exists
```

So `useParams().id` only exists after the workflow has a saved database id and the URL is `/workflow/<uuid>`.

There are two separate issues:

1. **No id exists yet on `/workflow/new`.**
   `WorkflowEditor` initializes new workflows with `workflowId = null` and only sets it after `saveWorkflow()` inserts the row and returns `result.newId`.

2. **The earlier BaseNode prop idea is incomplete.**
   `BaseNode` can accept a `workflowId` prop, but `ReactFlow` renders `NodeRouter` directly from `nodeTypes`, and `NodeRouter` currently calls:

   ```tsx
   <BaseNode data={data} selected={selected} readOnly={data.readOnly}>
   ```

   So no workflow id is actually injected into node execution. Even if injected, it would still be `null` until the new workflow is saved.

The backend error is correct: `POST /stream/:source/register` requires a real `workflowId` because stream subscriptions/listeners are scoped by workflow in Redis and later live metrics.

## Correct fix

Add an `ensureWorkflowId` path before any stream node execution.

### 1. In `WorkflowEditor.tsx`

Create an `ensureWorkflowId()` callback:

- If `workflowId` already exists, return it.
- If the editor is on `/workflow/new`, save the workflow first using the existing `saveWorkflow(null, workflowName, nodes, edges)` path.
- When save returns `newId`:
  - call `setWorkflowId(newId)`
  - navigate to `/dashboard/workflow/${newId}` with `replace: true`
  - return `newId`
- If saving fails, return `null` and stop execution.

Use this same callback for:

- manual single-node execution
- double-click / Execute All execution
- stream node register calls

### 2. Pass workflow context into ReactFlow nodes

Update the `nodeTypes` memo in `WorkflowEditor.tsx` so every `NodeRouter` receives:

```tsx
workflowId={workflowId ?? undefined}
ensureWorkflowId={ensureWorkflowId}
```

This must be done in the `nodeTypes` closure because ReactFlow only passes `data`, `selected`, etc. to custom node components.

### 3. In `NodeRouter.tsx`

Extend `NodeRouterProps` with:

```ts
workflowId?: string;
ensureWorkflowId?: () => Promise<string | null>;
```

Pass both into `BaseNode`.

### 4. In `BaseNode.tsx`

Use the prop first, route param second:

```ts
const { id: routeWorkflowId } = useParams();
const workflowId = propWorkflowId ?? routeWorkflowId;
```

Pass `ensureWorkflowId` into `useNodeExecution`.

### 5. In `useNodeExecution.ts`

Before building/sending the backend payload, resolve the active workflow id:

```ts
const activeWorkflowId = workflowId ?? (await ensureWorkflowId?.());
```

For streaming nodes, if `activeWorkflowId` is still missing, show an error and do not call the backend.

Set:

```ts
payload.workflowId = activeWorkflowId;
```

and use `activeWorkflowId` for streaming listener config too.

## Important behavior change

Executing a stream node from `/workflow/new` will auto-save the workflow first, then execute the stream node using the newly-created workflow id. That matches the backend requirement and avoids sending `undefined`.

## Out of scope

- No backend changes.
- No change to Redis key shape or live metrics scoping.
- No fake/random frontend-only workflow id; the backend should receive a real persisted workflow id.
- Unrelated `NodeRouter.tsx` TypeScript errors about `label` on dynamic handles are separate build issues and should be fixed separately if implementation mode surfaces them.

## Verification

1. Open `/dashboard/workflow/new`.
2. Add/configure `AlpacaStreamData`.
3. Click Execute without manually saving.
4. Confirm the app first saves/navigates to `/dashboard/workflow/<uuid>`.
5. Confirm the backend request payload includes `workflowId`.
6. Confirm `/stream/alpaca/register` no longer returns `400 "workflowId is required"`.
