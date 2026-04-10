
Updated understanding after tracing manual run + live activation end to end:

## What is actually broken

This is not just a crypto symbol issue.

### 1) There is a subscribe/register race in both manual and live flows
`SubscriptionService.subscribe()` does not wait for the broker/market-control layer to finish subscribing. It only publishes a Redis control message and returns success immediately.

Then both of these paths register the workflow right away:
- `coreza-backend/src/routes/stream.ts` → `/:source/register`
- `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts` → `activateStreaming()`

That means `register_workflow` often runs before the subscription keys/streams exist, so MarketControl logs exactly what you pasted:
- workflow registered
- 0 symbols found
- no data delivered

This explains:
- bar/kline not reaching workflow
- order_update companion stream not being visible yet
- manual run showing “success/listening” but backend not actually streaming to the workflow

### 2) Manual test-listener delivery is using inconsistent Redis contracts
`RegistrationService.createListener()` stores listeners in:
- `REDIS_CHANNELS.Listener(...)`
- `REDIS_CHANNELS.userActiveListeners(userId)`

But `WebSocketManager.checkTestListeners()` is still reading a different legacy/global listener registry contract from `config/streaming` (`REDIS_KEY_ACTIVE_TEST_LISTENERS` + legacy key assumptions).

So even if events do arrive, the WebSocket test-listener path may not discover the listener correctly.

Also, listener metadata is incomplete:
- `createListener()` stores `mode/scope/source`
- but `WebSocketManager` expects fields like `filterSymbols` / `filterTypes`

So manual test delivery is only partially wired.

### 3) Live crypto subscribe path still has a separate gap
`StreamingLifecycleAdapter.activateStreaming()` still only parses `nodeValues.symbols`.
For crypto nodes, live workflows use `crypto_base` + `crypto_quote`, so live market subscription can still be skipped there.

## Updated implementation plan

### A. Fix the core race first
Add a real “subscription ready” step before workflow registration.

#### Files
- `coreza-backend/src/services/SubscriptionService.ts`
- `coreza-backend/src/routes/stream.ts`
- `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts`

#### Change
Create a helper in the backend that waits until the expected Redis subscription state exists before continuing.

Example responsibility:
- after publishing `md:control:subscribe`
- wait until the expected workflow/global `...:streams` key contains the requested market streams
- for order updates, wait until the trading source subscription is present too
- timeout with a real backend error if readiness never happens

Then change ordering to:
```text
subscribe publish
-> wait for subscription readiness
-> publish register_workflow
-> start listener / workflow runner
```

This is the real fix for the “0 symbols” logs.

### B. Unify manual test-listener storage and consumption
#### Files
- `coreza-backend/src/services/RegistrationService.ts`
- `coreza-backend/src/infra/websocketManager.ts`
- `coreza-backend/src/config/streaming.ts`
- `coreza-backend/src/config/redisChannels.ts`

#### Change
Use one Redis key contract only.

`WebSocketManager.checkTestListeners()` must read the same keys that `RegistrationService.createListener()` writes.

Also extend listener payload to include everything the consumer expects:
- `filterSymbols`
- `filterTypes`
- `scope`
- `mode`
- `source`
- `workflowId`
- `nodeId`

This makes manual run truly end-to-end instead of “listener created but never matched”.

### C. Fix live crypto symbol building in the workflow activation path
#### Files
- `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts`
- optionally shared helper: `coreza-backend/src/utils/symbolHelpers.ts`

#### Change
Use the same crypto symbol resolution in live activation that manual `/stream/:source/register` already uses:
- `crypto_base` + `crypto_quote` -> `BTC/USD`, etc.

Without this, live Alpaca crypto streaming can still register with no market symbols.

### D. Make order_update registration wait for trading subscription readiness too
#### Files
- `coreza-backend/src/routes/stream.ts`
- `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts`

#### Change
When `order_update` is selected:
- subscribe trading source first
- wait for trading subscription Redis state
- then register workflow

This matters because companion trading stream discovery is happening during registration. If trading subscription is still not materialized, registration sees nothing.

### E. Clean up stop/unregister logic for source variants
#### Files
- `coreza-backend/src/routes/stream.ts`

#### Change
`/stream/unregister` currently only special-cases:
- `alpaca_market`
- `binance_market`

That is too narrow for:
- `alpaca_crypto`
- future source variants

Make trading companion cleanup derive from source family, not hardcoded source names.

### F. Optional but recommended: fix stale recovery fallback
#### Files
- `src/hooks/useListeningConfigs.ts`
- corresponding backend route if needed

#### Change
The recovery polling endpoint/template looks stale/inconsistent (`workflow_id` vs `workflowId`, `/market/stream-test-result` path mismatch). WebSocket is primary, but fallback should be corrected so test listening degrades safely.

## Expected result after the fix
```text
Manual subscribe mode:
  publish subscribe
  -> backend waits until Redis shows active stream subscription
  -> create/register listener
  -> incoming bar/kline/order_update event matches listener
  -> WebSocketManager pushes test_data_received
  -> UI shows streaming output

Live workflow activation:
  publish subscribe
  -> wait until stream keys exist
  -> publish register_workflow
  -> MarketControl sees non-zero subscribed streams
  -> WorkflowRunner receives events
```

## Files most likely to change
- `coreza-backend/src/services/SubscriptionService.ts`
- `coreza-backend/src/routes/stream.ts`
- `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts`
- `coreza-backend/src/services/RegistrationService.ts`
- `coreza-backend/src/infra/websocketManager.ts`
- `coreza-backend/src/config/streaming.ts`
- `coreza-backend/src/config/redisChannels.ts`
- optional: `coreza-backend/src/utils/symbolHelpers.ts`
- optional: `src/hooks/useListeningConfigs.ts`

## Priority order
1. Fix subscribe/register race
2. Unify listener Redis contract
3. Fix crypto live symbol construction
4. Fix unregister source handling
5. Fix recovery fallback

This updated plan replaces the earlier “crypto-only” diagnosis. The main failure is orchestration timing plus mismatched listener plumbing.
