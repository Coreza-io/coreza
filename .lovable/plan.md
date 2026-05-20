# Fix: workflowId missing from stream node requests

## Root cause

`BaseNode` derives `workflowId` from `useParams()` (`src/components/nodes/BaseNode.tsx:118`), reading the React Router `:id` segment.

The workflow editor is mounted on two routes (`src/pages/Interface.tsx:73-74`):

- `workflow/:id` — `useParams().id` is the saved workflow UUID.
- `workflow/new` — there is no `:id` segment, so `useParams().id` is `undefined`.

For an unsaved (or freshly created) workflow, `workflowId` resolves to `undefined`. The payload assignment `payload.workflowId = workflowId` in `useNodeExecution.ts:370` then writes `undefined`, which `JSON.stringify` strips, so the field never reaches the backend — exactly matching the screenshot where `req.body` has no `workflowId` key and the backend rejects with `"workflowId is required"`.

`WorkflowEditor` already maintains the correct value (`src/pages/WorkflowEditor.tsx:196`, updated on first save at line 795) and passes it down as a `workflowId` prop through `BasicNodeLayout` → `BaseNode`. `BaseNode` even declares the prop (`workflowId?: string`, line 62) but never reads it — the local `useParams` value shadows it.

## Fix

In `src/components/nodes/BaseNode.tsx`:

1. Destructure `workflowId` from props (it's already typed on `BaseNodeProps`) and rename the `useParams` value:
   ```ts
   const { id: routeWorkflowId } = useParams();
   const workflowId = propWorkflowId ?? routeWorkflowId;
   ```
2. Keep `useParams` as a fallback so legacy callers that don't pass the prop still work.

That single change makes `payload.workflowId` populated for `/workflow/new` and any post-save state where the URL hasn't refreshed yet.

## Out of scope

- No backend changes — the `400 "workflowId is required"` guard at `coreza-backend/src/routes/.../execute-stream-node` is correct and stays.
- No changes to `useNodeExecution`, `WorkflowEditor`, or routing.
- Other consumers (`WorkflowHeader`, `MarketSubscriptions`, `BasicNodeLayout`) already pass `workflowId` explicitly — untouched.

## Verification

1. Open a new workflow (`/workflow/new`), drop an `AlpacaStreamListener`, hit Execute → backend should receive `workflowId` and not 400.
2. Save the workflow, refresh, repeat on the `/workflow/:id` route → still works (fallback path).
