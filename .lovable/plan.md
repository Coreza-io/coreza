# Allow manual (unsaved) workflows to publish market data to frontend

## Root cause

Frontend now sends the pre-generated `workflowId` correctly. The `MarketDataSubscriber.registerWorkflow(...)` call succeeds and Redis subscriptions are set up. But when a market event arrives, the delivery path bails:

`coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts` → `deliverWorkflowEvent` (line ~779):

```ts
const workflow = await this.getWorkflowCache().getWorkflow(workflowId);
if (!workflow) {
  console.error(`❌ Workflow ${workflowId} not found or inactive`);
  return;          // ← exits before publishToFrontend
}
```

`WorkflowCache.getWorkflow` queries `supabase.from("workflows").select("*").eq("id", workflowId).single()`. For an unsaved new workflow there is no row → returns `null` → delivery is dropped → frontend never receives the event over the user channel.

Notice the fetched `workflow` variable is **never read** after the null check in this function — it's only used as a gate.

## Fix: don't require a DB row for the manual (non-live) path

The DB lookup is only meaningful when `registration.isLive === true` (the WorkflowRunner path needs the persisted definition). For `isLive === false` (manual test from the editor), we only need to:

1. Append to the strategy stream (`appendToWorkflowStream`)
2. Publish to the user's frontend channel (`publishToFrontend`)

Neither step uses the `workflow` object.

### Change in `coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts`

Inside `deliverWorkflowEvent` (~line 789), gate the cache fetch on `isLive`:

```ts
// Only the live runner path needs the persisted workflow definition.
// Manual (unsaved) workflows publish to the frontend without a DB row.
if (registration.isLive) {
  const workflow = await this.getWorkflowCache().getWorkflow(workflowId);
  if (!workflow) {
    console.error(
      `❌ [MarketDataSubscriber] Live workflow ${workflowId} not found or inactive`
    );
    return;
  }
}
```

Everything below (formatting, `appendToWorkflowStream`, `publishToFrontend`) runs unchanged for both paths.

### Also relax `restoreFromRedis` (line ~299)

Same pattern when restoring persisted registrations on service start:

```ts
if (registration.isLive) {
  const workflow = await this.getWorkflowCache().getWorkflow(
    registration.workflowId,
  );
  if (!workflow) {
    console.warn(`⚠️ Skipping inactive live workflow ${registration.workflowId}`);
    continue;
  }
}
```

Manual registrations should be restored regardless of DB presence (they're transient anyway, but the existing pattern drops them too).

## Why this is safe

- `isLive=true` activation already requires a saved workflow (the Activate toggle is disabled until save), so the DB row will exist. Gate behavior unchanged.
- `isLive=false` is the editor's "register so the canvas shows live ticks" path. It writes nothing to DB and only publishes to the per-user frontend channel — `workflow` row is not needed.
- No schema, no API, no frontend changes.

## Out of scope

- No change to `WorkflowCache` (still fetches when called).
- No backend save-on-execute auto-persistence.
- No change to `WorkflowRunnerManager` / `WorkflowRunner` (live path still requires the saved definition, by design).

## Verification

1. Open `/dashboard/workflow/new` → drop AlpacaStreamData → Execute.
2. Backend log: `📊 Registering workflow <uuid> ... (isLive: false)` then `✅ registered`.
3. When a tick arrives, log should NO LONGER show `❌ Workflow <uuid> not found or inactive`. Instead `publishToFrontend` runs and the canvas node shows incoming data.
4. Save the workflow, toggle Activate (isLive=true) → live path still works because the row now exists.
