# Why manual stream-node leaves `sub:` keys, but activate/deactivate live doesn't

## TL;DR

Both flows use the **same** `SubscriptionService.subscribe` → `MarketControlHandler.handleSubscribe` path, which writes the `sub:userId:..:streams` SET in Redis. The difference is on the **stop/deactivate** side:

- **Live activate then deactivate** runs `WorkflowLifecycleService.deactivate` → `streaming.cleanupWorkflowSubscriptions` (`StreamingLifecycleAdapter.ts:581`). That scans every `sub:userId:..:workflowId:..:streams` key, publishes a proper `controlUnsubscribe` for the streams in it, and finally `del`s the key (line 693). So after deactivation the `sub:` key is *correctly gone*.
- **Manual stream-node "subscribe" mode** writes the same `sub:` key during start. The only stop hook is `POST /stream/stop` (`routes/stream.ts:1109`-1158) which already calls `SubscriptionService.unsubscribe` for that node's specific streams. That works **only if the UI actually fires the stop endpoint**. If the user just closes the tab, navigates away, or the listener TTL expires, no one publishes `controlUnsubscribe` and the `sub:` key lives until something else evicts it.

So the apparent asymmetry is a perception + missing-fallback issue, not a missing subscribe.

## What about `md:` channels?

`md:stream:<stream>` and `md:symbol:<SYMBOL>` are **pub/sub channels**, not Redis keys. They are present in both flows but never show up in `KEYS` / RedisInsight key listings — only in `PUBSUB CHANNELS`. The `sub:` entries are SET keys. Comparing one against the other made the flows look different when they aren't.

`md:gateway:*` (and `gateway:userId:..:state`) keys are written by `MarketControlHandler.persistState` whenever a gateway becomes active; both flows produce these too.

## Confirmation in code

- `StreamingLifecycleAdapter.activateStreaming` (`:215`-:375`) calls `SubscriptionService.subscribe` for trading / news / market in sequence and `waitForSubscriptionReady` polls the `sub:` key until `SCARD > 0`. If the key were not being created on activate, that poll would time out and throw `Activation failed: Market subscription readiness timed out ...` — which we are not seeing.
- `MarketControlHandler.handleSubscribe` (`:641`) is the single writer of `sub:..:streams` via `redisPub.sadd(streamsKey, ...newStreamNames)` (`:748`). Both flows publish to the same control channel and exercise this code.
- `WorkflowLifecycleService.deactivate` (`:177`) calls `streaming.cleanupWorkflowSubscriptions` unconditionally — that's why the `sub:` key disappears the moment the workflow is turned off.
- `routes/stream.ts` POST `/stream/execute` registers the listener but does **not** add anything that fires on listener TTL expiry. The only cleanup is the explicit POST `/stream/stop`.

## Fix — make manual and live symmetric

Goal: a manual stream-node listener should leave Redis in the same shape as a deactivated live workflow once it stops, no matter how it stops.

1. **`coreza-backend/src/services/RegistrationService.ts > deleteListener`** — after deleting the listener key, call `streaming.cleanupWorkflowSubscriptions(userId, workflowId)` for the listener's `(userId, workflowId)` pair so the `sub:` key is removed and `controlUnsubscribe` is fanned out. (Today this only runs from `WorkflowLifecycleService.deactivate`.) This makes the explicit `/stream/stop` path idempotent and also covers any other callers of `deleteListener`.

2. **Listener TTL expiry sweep** — `LISTENER_TTL_SECONDS` is enforced by Redis SETEX, so an abandoned tab silently expires the listener key but never publishes unsubscribe. Add a small reaper in `RegistrationService` (or piggy-back on `cleanupWorkflowListeners` which already iterates `userActiveListeners`): for every entry in `listener:userId:<u>:active` whose detail key no longer exists (`EXISTS` returns 0), run the same cleanup as `deleteListener` for that `(workflowId, nodeId)`. Schedule from the existing periodic cleanup loop in `market-stream-service/src/services/WorkflowCache.ts` or a new lightweight job in the backend — whichever already runs every ~60s.

3. **Doc/UX nit (optional)** — update the inline comment on `REDIS_CHANNELS.marketData` / `streamData` to remind that those are pub/sub channels, and add a one-line note in `docs/redis-key-audit-2026-04-05.md` clarifying that `sub:` keys are SETs while `md:*` are channels. Helps the next person debugging this.

## Verification

- Manual stream-node test (Binance, ETHUSDT, kline_1m), then click Stop → `KEYS 'sub:userId:<u>:scope:workflow:workflowId:<wf>:*'` returns empty, and `PUBSUB CHANNELS 'md:stream:ethusdt@kline_1m'` shows zero subscribers.
- Manual stream-node test, then close the tab and wait for TTL → after the reaper tick, same empty state as above. Logs show `🗑️ Removed empty streams key sub:...:streams` and `🔌 No streams left, disconnecting binance gateway`.
- Live activate then deactivate continues to behave as it does today (already correct).
- Both flows: `gateway:userId:<u>:binance:state` is present only while at least one stream is active and is deleted when the last stream goes.
