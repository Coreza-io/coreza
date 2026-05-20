# Fix: workflowId undefined on /workflow/new

## Approach

Always generate a `workflowId` (UUID) the moment a new workflow editor opens — before the user saves. Do **not** insert any row into the `workflows` table; the id stays purely client-side until the user clicks Save. On first save, that same id is used as the row's primary key so URL, Redis keys, and DB row all match.

## Why this works

- Backend `POST /stream/:source/register` only needs a stable `workflowId` string. It does not require the workflow to exist in Supabase to scope Redis streams.
- A pre-generated UUID survives across stream subscriptions, listener registration, and the eventual save — no id swap, no broken Redis keys.
- The user keeps the "draft until I press Save" semantic. Nothing hits the DB until they explicitly save.

## Changes

### 1. `src/pages/WorkflowEditor.tsx`

- On `/workflow/new`, initialize `workflowId` to `crypto.randomUUID()` instead of `null`:

  ```ts
  const [workflowId, setWorkflowId] = useState<string | null>(
    isNewWorkflow ? crypto.randomUUID() : id || null,
  );
  ```

- Do **not** navigate the URL to `/workflow/<uuid>` on creation. URL stays `/workflow/new` until first save (keeps "unsaved draft" UX).
- Keep the existing URL sync effect for the `/workflow/:id` route case.
- In `handleSaveWorkflow`, when on `/workflow/new`, pass the pre-generated `workflowId` into `saveWorkflow` so the DB row uses the same id. After successful insert, navigate to `/dashboard/workflow/${workflowId}` with `replace: true`.

### 2. `src/hooks/useWorkflowPersistence.ts`

- Update `saveWorkflow` to accept an optional `presetId` (or reuse the existing `workflowId` argument when non-null) and include it in the insert payload as `id: presetId` for new workflows. Postgres accepts a client-supplied UUID for the `id` column.
- Return `{ success: true, newId: presetId }` so existing caller code keeps working.

### 3. Wire `workflowId` into nodes

`ReactFlow` only passes `data` and `selected` to custom node components, so the prop must flow through the `nodeTypes` closure:

- In `WorkflowEditor.tsx` `nodeTypes` memo, wrap `NodeRouter` so it receives `workflowId` (and `Loop` too) as a prop.
- Update `NodeRouter` props to accept `workflowId?: string` and forward it to `<BaseNode workflowId={workflowId} …>`.
- `BaseNode` already has `workflowId?: string` and uses `propWorkflowId ?? routeWorkflowId` — no further change needed there.

### 4. `useNodeExecution.ts`

No logic change. `payload.workflowId = workflowId` will now always have a real UUID for `/workflow/new` because the prop chain delivers it.

## Out of scope

- No backend changes.
- No automatic save-on-execute. The user still controls when the workflow is persisted.
- No new DB row at editor open. Only when the user clicks Save.
- Unrelated `NodeRouter.tsx` TypeScript errors about `label` on dynamic handles are pre-existing and not in scope here.

## Verification

1. Open `/dashboard/workflow/new`. Confirm a workflowId exists in React state (visible in `🚀 [BACKEND REQUEST] Payload` log when executing a node).
2. Add `AlpacaStreamData`, click Execute without saving.
3. Backend request body contains `workflowId: "<uuid>"`. `/stream/alpaca/register` returns 200.
4. URL still shows `/workflow/new`. No row in `workflows` table yet.
5. Click Save. The row is inserted with that same UUID. URL navigates to `/dashboard/workflow/<uuid>`. Refresh reloads the same workflow.
