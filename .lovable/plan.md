

# Plan: Use `isLive` Flag to Gate Stream Append in Market Data Delivery

## Why `isLive` Cannot Be Used Directly

The `isLive` flag lives in `WorkflowEngine` / `NodeExecutionContext` inside the **backend engine** (`coreza-backend/src/engine/`). It's set when a `WorkflowRunner` is constructed to consume the Redis Stream.

However, the decision to **write to the Redis Stream** (`appendToWorkflowStream`) happens in `MarketDataSubscriber` inside **market-stream-service** — a completely separate process. This service has no access to `WorkflowEngine` or its `isLive` flag. It only knows about `WorkflowRegistration` objects (workflowId, nodeId, userId, streams, source).

The `isLive` flag answers: "should the engine persist trades/fills?" — an engine-level concern. The question here is: "should market data be written to the Redis Stream?" — a routing-level concern. These are different layers.

## What Actually Works

The cleanest approach is to add an `isLive` field to the **registration control message** and store it in the `WorkflowRegistration` object. This way:

- **Manual test** (`/stream/:source/register` route) → publishes with `isLive: false` → `MarketDataSubscriber` skips `appendToWorkflowStream`, only calls `publishToFrontend`
- **Workflow activation** (`StreamingLifecycleAdapter`) → publishes with `isLive: true` → full pipeline (frontend publish + stream append)

This reuses the `isLive` naming convention without inventing a new concept.

## Changes

### 1. `RegistrationService.publishRegisterWorkflow()` — Add `isLive` param

Add optional `isLive?: boolean` to the control message payload (default `false`).

### 2. `StreamingLifecycleAdapter.activateStreaming()` — Pass `isLive: true`

The activation path explicitly sets `isLive: true` when calling `publishRegisterWorkflow`.

### 3. `stream.ts` register route — No change needed

It already calls `publishRegisterWorkflow` without `isLive`, which defaults to `false`.

### 4. `MarketControlHandler.handleRegister()` — Forward `isLive` to subscriber

Pass the `isLive` field through to `subscriber.registerWorkflow()`.

### 5. `MarketDataSubscriber` — Store and check `isLive`

- Add `isLive: boolean` to `WorkflowRegistration` interface
- In `registerWorkflow()`, store the flag
- In `deliverWorkflowEvent()`, skip `appendToWorkflowStream()` when `isLive === false`

### 6. `stream.ts` register route — Remove `startWorkflowRunner`

Remove lines 561-580 (`startWorkflowRunner`) and line 666 (`stopWorkflowRunner`) from register/unregister routes. The `WorkflowRunner` is only started by `StreamingLifecycleAdapter` during activation.

## Files to Modify

| File | Change |
|------|--------|
| `coreza-backend/src/services/RegistrationService.ts` | Add `isLive?: boolean` to `publishRegisterWorkflow` params and control message |
| `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts` | Pass `isLive: true` to `publishRegisterWorkflow` |
| `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts` | Forward `isLive` from control message to `registerWorkflow()` |
| `coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts` | Add `isLive` to `WorkflowRegistration`; skip `appendToWorkflowStream` when `!isLive` |
| `coreza-backend/src/routes/stream.ts` | Remove `startWorkflowRunner` (lines 561-580) and `stopWorkflowRunner` (line 666) |

## Data Flow After Fix

```text
MANUAL TEST (editor "Run" on AlpacaStreamData):
  /register → publishRegisterWorkflow(isLive: false)
  → MarketDataSubscriber stores registration with isLive=false
  → On market tick: publishToFrontend() ✅, appendToWorkflowStream() ❌ SKIPPED
  → No WorkflowRunner started, no downstream execution

WORKFLOW ACTIVATION:
  StreamingLifecycleAdapter → publishRegisterWorkflow(isLive: true)
  → MarketDataSubscriber stores registration with isLive=true
  → On market tick: publishToFrontend() ✅, appendToWorkflowStream() ✅
  → WorkflowRunner consumes stream, executes full graph
```

