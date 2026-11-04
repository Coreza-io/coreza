# Surface terminal market-stream errors and stop the listener

## Problem

The Dhan Stream Listener stayed on **Listening** after six rapid WebSocket closes (the initial connection and five retries). The last close was `1006` with no provider reason. Coreza registered the workflow in Redis and logged retry exhaustion in the market-stream service, while the editor continued displaying the successful registration response. This incident does not establish that the saved credential expired.

On `dev`, [stream registration](../coreza-backend/src/routes/stream.ts#L723) returns `listening` after publishing registration. [MarketDataGateway](../coreza-backend/market-stream-service/src/services/MarketDataGateway.ts#L783) alerts and returns on retry exhaustion and already has a branch that skips reconnecting after a fatal provider control message. The [webhook error handler](../src/contexts/ExecutionStoreContext.tsx#L168) is the precedent for delivering a terminal error to the current node and clearing its listening state.

## Expected behavior

| Outcome | Output panel | Backend |
| --- | --- | --- |
| Start request accepted, gateway readiness pending | Connecting | Track the listener attempt and its required feeds |
| Required gateway and routing are ready | Listening | Deliver events through existing routing |
| Socket closes and a retry is scheduled | Reconnecting | Keep the registration and subscription ownership |
| Gateway recovers | Listening | Resume delivery for the same attempt |
| Provider explicitly rejects credentials or another fatal request | Failed with provider reason and code | Stop the affected attempt immediately |
| Retry budget is exhausted | Failed with last close code and retry count | Stop the affected attempt and release its registrations |

For the reported run, show **Dhan stream disconnected (1006). Reconnection failed after 5 attempts.** Display credential expiry only when supported by a provider error. When the provider has no explicit auth or subscription acknowledgment, distinguish WebSocket open and subscription sent from provider-confirmed authentication in logs. Avoid using first tick or first closed candle as the only readiness signal, since healthy feeds can be quiet.

## Implementation

1. **Emit lifecycle events from the market-stream service.** In `MarketDataGateway`, capture the sanitized last failure and report retry scheduled, recovery, fatal provider rejection, and retry exhaustion through the existing gateway/control integration. Emit terminal failure once per failed gateway cycle, including for failures before connection completes, and distinguish intentional stop. Use the Dhan adapter’s provider message decoding for broker codes. Preserve the retry policy for ambiguous disconnects such as `1006`.
2. **Associate failures with the right listeners.** Use the existing Redis registration and control path through `routes/stream.ts`, `RegistrationService`, and `MarketControlHandler`. Assign a unique attempt ID when a manual listener starts and correlate by user, workflow, node, attempt, and the actual gateway identity, including source, environment and credential or connection identity where applicable. Record the dependency before starting the gateway, or retain its latest status so an immediate failure can be reconciled after registration. Cover both Subscribe & Register and Listen, including Dhan market and order-update companion feeds. Match the actual feed dependencies of each attempt, including shared subscriptions.
3. **Make terminal stop a backend operation.** Extract and reuse the cleanup behind `POST /stream/unregister` as appropriate. For the matching attempt, unregister its routing, release subscriptions it owns, delete active listener state and decrement the count exactly once. Preserve subscriptions with other owners and externally established subscriptions that a Listen node merely consumes. Make concurrent user Stop and terminal failure safe and prevent stale cleanup from removing a replacement listener. Retain terminal status separately from active routing state for the existing status/reconnect flow, with bounded retention.
4. **Deliver status to the Output panel.** Use the existing user WebSocket channel, modeled on `WebhookService.dispatchInternalError`, with a market-stream lifecycle event. In `ExecutionStoreContext.tsx`, match the current listener attempt, show Connecting or Reconnecting while it is active, and on terminal failure store a unified `resultFailure` with code and timestamp, clear listening flags, and remove the active Stop control. Make terminal state win over late registration responses, replay/data events and older status updates. A browser that misses the WebSocket event should reconcile with the backend status when it reconnects. Keep this work in the control path.
5. **Scope the first implementation to editor stream listeners.** Apply the shared lifecycle mechanism to that path, with Dhan as the regression case. Live workflow run-state and restart policy are separate from manual listener cleanup. A shared gateway failure must not cause the manual cleanup path to remove a live workflow or another listener’s ownership.

## Verification

- Extend `MarketDataGatewayReconnect.test.ts` to cover repeated `1006` closes, one terminal event after the last retry, fatal provider rejection without retries, recovery, and intentional stop without a failure event.
- Verify backend routing and cleanup for failures before and after registration, shared subscribers, different credentials and environments, Dhan market plus order updates, and concurrent Stop or restart. Check listener counts and routing after failure.
- Verify the Output panel shows the terminal error and exits Listening. Cover delayed start responses, stale events from a previous attempt, and a browser reconnect after the terminal event.
- Reproduce the Dhan sandbox disconnect with a mocked close sequence or a known failing sandbox credential. Then repeat with a working sandbox credential and confirm that ticks or closed bars continue through the existing delivery path.
