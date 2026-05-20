# Fix: workflowId missing from stream node requests on /workflow/new

## What's happening

You're executing `AlpacaStreamData` on `/workflow/new`. The backend `POST /stream/:source/register` rejects the call with `400 "workflowId is required"` because the frontend never puts `workflowId` in the body.

## Root cause

`BaseNode` reads `workflowId` from the URL:

```ts
const { id: workflowId } = useParams();
```

The workflow editor is mounted on two routes (`src/pages/Interface.tsx`):

- `workflow/:id` — `useParams().id` is the saved workflow UUID. Works.
- `workflow/new` — there is no `:id` segment, so `useParams().id` is `undefined`. Broken.

For a brand-new (unsaved) workflow, `workflowId` resolves to `undefined`. In `useNodeExecution.ts:370`, `payload.workflowId = workflowId` writes `undefined`, which `JSON.stringify` strips, so the field never reaches the backend. That's why it "worked yesterday" — the workflow had already been saved by then and the URL was `/workflow/<uuid>`.

`WorkflowEditor` already tracks the correct value in local state (initialized from URL, updated on first save at `src/pages/WorkflowEditor.tsx:795` when `setWorkflowId(result.newId)` runs). It even passes it down as a `workflowId` prop through `BasicNodeLayout` → `BaseNode`, and `BaseNode` declares the prop on `BaseNodeProps` (line 62). The prop is currently unused — the `useParams` value shadows it.

## Fix

In `src/components/nodes/BaseNode.tsx`:

1. Destructure `workflowId` from the component props (already typed as `workflowId?: string`).
2. Rename the `useParams` value and use it only as a fallback:

   ```ts
   const BaseNode: React.FC<BaseNodeProps> = ({ data, selected, readOnly, workflowId: propWorkflowId, children }) => {
     // ...
     const { id: routeWorkflowId } = useParams();
     const workflowId = propWorkflowId ?? routeWorkflowId;
   ```

3. Leave everything else alone — the rest of the file already reads from the local `workflowId` binding.

That single change makes `payload.workflowId` populated on `/workflow/new` (because `WorkflowEditor` passes the in-memory state value), and keeps it working on `/workflow/:id` via the `useParams` fallback for any caller that doesn't pass the prop.

## Out of scope

- No backend changes. The `400 "workflowId is required"` guard at `coreza-backend/src/routes/stream.ts:748` is correct and stays.
- No changes to `useNodeExecution`, `WorkflowEditor`, or routing.
- Other consumers (`WorkflowHeader`, `MarketSubscriptions`, `BasicNodeLayout`) already pass `workflowId` explicitly — untouched.

## Verification

1. Open a new workflow (`/workflow/new`), drop an `AlpacaStreamData` node, click Execute.
2. Check the `🚀 [BACKEND REQUEST] Payload` console log — it should now include `"workflowId": "<uuid>"` (the freshly-generated id from `WorkflowEditor` state).
3. Backend should respond 200 instead of `400 "workflowId is required"`.
4. Save, refresh onto `/workflow/<uuid>`, repeat — still works via the `useParams` fallback path.
