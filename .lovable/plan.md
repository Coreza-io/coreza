# Redis keys + upstream streams persist after deactivating a live workflow

## Confirming the previous fix

Per-node execution timing now displays the real backend duration for every node (sub-ms included). That fix is done. This plan is a new investigation.

## What's actually wrong

Two distinct leaks on workflow deactivation:

1. **Upstream broker subscription is never torn down.** The backend keeps publishing `md:stream:ethusdt@kline_1m` even after the workflow is deactivated and `Unregistered streaming workflow ...` is logged.
2. **Workflow-scoped Redis keys are left behind.** The Redis screenshot shows `fills`, `strategy`, `order`, `gateway`, `listener`, `registry`, plus `bull`/`scheduled-workflows` namespaces still populated.

## Why — root causes

### 1. Deactivation only unregisters the routing table, not the gateway

`coreza-backend/src/workflow/StreamingLifecycleAdapter.ts > deactivateStreaming()` does:

```text
- srem activeStreamingWorkflows
- del workflowStreamFilter
- OrderOwnerRegistry.cleanupByWorkflow
- cleanupWorkflowListeners
- RegistrationService.publishUnregisterWorkflow   // → controlUnregister
- jobQueue.stopWorkflowRunner
- // clearSessionData(...) is COMMENTED OUT
```

The `controlUnregister` message lands in `market-stream-service/src/services/MarketControlHandler.ts > handleUnregister()`, which only calls `MarketDataSubscriber.unregisterWorkflow(...)`. That method is explicit about its scope:

> "This does NOT unsubscribe from a broker - it removes the workflow from the internal routing table"

So:
- The workflow is removed from the in-process routing map.
- The Redis fan-out channel `md:stream:<symbol>@<interval>` is unsubscribed only if no other workflow needs it.
- **But** the upstream broker websocket (e.g. Binance kline_1m for ETHUSDT) is never closed and `MarketDataGateway.unsubscribeStreams` is never called, so the gateway keeps publishing forever. That matches the screenshot: `PUBLISHED to Redis channel: md:stream:ethusdt@kline_1m` after deactivation.

By contrast, the explicit `handleUnsubscribe` path *does* the right thing — it calls `state.gateway.unsubscribeStreams(...)`, decrements per-workflow stream sets, and `state.gateway.disconnect()` when `state.streams.size === 0`. Deactivation never goes through that path.

### 2. Workflow-scoped session keys are not cleared

`clearSessionData()` (which deletes `strategyStream`, `portfolioFillsStream`, `portfolioSnapshotLatest`, `order:*`, `orderReverse:*` and updates the active-streams registries) exists and is called from other lifecycle paths (`unregisterStreamingTriggers`, fallbacks) but is **commented out** in `deactivateStreaming()`. So:

- `fills:userId:..:workflowId:..:stream` → orphaned
- `strategy:userId:..:workflowId:..:stream` → orphaned
- `order:userId:..:workflowId:..:*` and `orderReverse:..` → orphaned
- `registry:fills:active`, `registry:snapshots:active` → still list the user

`WorkflowRunner.cleanupRunnerKeys()` only matches `*:userId:..:workflowId:..:executionId:..:*` so it can't catch any of these workflow-scoped (no `executionId` segment) keys.

### 3. Gateway state persists in Redis

`md:gateway:state:<userId>:<source>` (the `gateway` folder in the screenshot) is only `del`'d inside `handleUnsubscribe` when `state.streams.size === 0`. Since deactivation never triggers `handleUnsubscribe`, this key stays.

### Out of scope but worth noting

- `cred:*` is intentionally global (per project memory) — leave it.
- `bull:*` and `scheduled-workflows:*` are BullMQ infra (job state, repeatable schedulers); they have their own retention/cleanup and are not per-deactivation garbage.
- `listener:*` and `registry:*` — registry is partially cleared by `clearSessionData`; listener entries should be covered by `cleanupWorkflowListeners` (already called). Verify after fix.

## Fix

### Backend (`coreza-backend/src/workflow/StreamingLifecycleAdapter.ts`)

1. **In `deactivateStreaming(userId, workflowId)`**, before publishing `unregisterWorkflow`, look up the workflow's nodes (the existing call sites already have them — pass them in, or load via `WorkflowRepository`) and call `unsubscribeStreamingNodes(userId, workflowId, nodes)` first. That publishes `controlUnsubscribe` for every streaming node, which exercises the proper `handleUnsubscribe` path in the market-stream-service: gateway streams removed, broker websocket disconnected when last stream goes, `md:gateway:state:*` key deleted.
2. **Uncomment `await this.clearSessionData(userId, workflowId);`** at the end of `deactivateStreaming`. That removes `strategy`/`fills`/`snapshot`/`order`/`orderReverse` keys and updates the active-streams registries.
3. **Update `WorkflowLifecycleService > deactivate(workflow, ...)`** to pass `workflow.nodes` into `deactivateStreaming` so step 1 has the node list (avoid a second DB read if it already has them).

### Market-stream-service (`coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`)

4. **Harden `handleUnregister`** as a safety net for older clients/tests that only send the unregister message: after `subscriber.unregisterWorkflow(...)`, iterate `this.sourceStates` for that `userId`, drop the workflow from `state.workflowStreams`, recompute streams still claimed by any remaining workflow, and call `state.gateway.unsubscribeStreams(orphaned)` plus the same "no streams left → `gateway.disconnect()` + delete `gatewayState`" block that already lives in `handleUnsubscribe`. This ensures deactivation cleans up even if step 1 above misses a stream.

### Workflow runner key cleanup (already correct, no change)

`WorkflowRunner.cleanupRunnerKeys()` is fine; the leaks above are workflow-scoped, not execution-scoped, so they require workflow-scoped cleanup in `clearSessionData`.

## Verification

After deactivating a live Binance ETHUSDT workflow:

- Backend logs stop showing `PUBLISHED to Redis channel: md:stream:ethusdt@kline_1m` within ~1 second.
- Market-stream-service logs show `🔌 No streams left, disconnecting binance gateway` and `Disconnected binance gateway`.
- `redis-cli KEYS 'fills:userId:*:workflowId:<id>:*'`, `strategy:...`, `order:...:workflowId:<id>:*`, `md:gateway:state:<userId>:binance`, `workflow:userId:<userId>:workflowId:<id>` all return empty.
- `cred:*`, `bull:*`, `scheduled-workflows:*` are unaffected (intentional).
- Re-activating the same workflow still works end-to-end — no stale state interferes.
