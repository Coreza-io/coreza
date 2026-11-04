# Validate broker credentials before saving

## Current flow

The Connect modal posts the submitted fields to `POST /broker/:broker/auth`. The route in [broker.ts](../coreza-backend/src/routes/broker.ts) calls `CredentialManager.saveCredentials` without checking whether the broker accepts the credentials. The existing [CredentialValidator](../coreza-backend/src/utils/credentialValidator.ts) checks credential structure.

## Implementation

1. In the existing authenticated broker auth route, run `CredentialValidator.validateCredentials` on the submitted values. Reject missing or malformed fields and unsupported environment or market selections before making a broker request. Keep the current defaults for omitted selections where supported.
2. Before calling `saveCredentials`, use the existing broker HTTP config to make one read-only `get_account` request with the submitted credentials. Reuse the configured base URL, headers, and operation parameters, including Binance request signing. Use a short timeout and no automatic retry. Use only the known account-read operation with the selected environment and market. Keep this call in the credential creation flow so it does not require a saved credential ID or run as part of workflow execution.

   | Broker | Read-only check |
   | --- | --- |
   | Dhan | Use the configured live or sandbox host and call `GET /fundlimit` with the submitted access token. Require the returned `dhanClientId` to match the submitted `client_id` before saving. A response that cannot establish the account identity does not pass. [Dhan API reference](https://dhanhq.co/docs/v2/funds/) |
   | Alpaca | Use the configured paper or live account endpoint with the submitted key and secret. |
   | Binance | Use the configured signed spot or futures account endpoint for the submitted environment. |

3. Save through the existing credential manager only after the broker check succeeds. Preserve the current success response and encrypted save path. On rejection or a client ID mismatch, return an actionable `{ error }` message. For a timeout, rate limit, or upstream outage, say validation could not be completed and ask the user to retry. Any failed check must leave the store and cache untouched, including when the label already exists. Keep credentials, raw provider responses, and signed URLs out of logs and client errors.
4. Reuse [GenericAuthModal](../src/components/auth/GenericAuthModal.tsx) and its existing Connecting, error, and success states. The modal keeps the entered values on failure and closes after a successful save.

## WebSocket readiness when starting stream nodes

Keep the REST account check on **Connect**. Check the WebSocket when a Subscribe or Stream Listener node starts, once the feed, environment and requested channels are known. Use the actual gateway connection for the selected account and feed. Reuse a healthy matching connection where possible to avoid opening a separate probe socket.

| Node action | When to report success |
| --- | --- |
| **Subscribe** | The WebSocket is open, provider authentication has succeeded where explicitly supported, and the provider has acknowledged the requested symbols and channels where it sends an acknowledgment. An existing confirmed subscription on the same live connection can satisfy the request. |
| **Stream Listener · Subscribe & Register** | The same subscription readiness check passes and listener routing is registered. |
| **Stream Listener · Listen** | A subscription in the selected scope matches the requested feed and streams, and its gateway is currently connected and ready. If no active match exists, show an error and direct the user to subscribe first. |

- Reuse the existing [subscription confirmation path](../coreza-backend/src/services/SubscriptionService.ts) and [gateway control handler](../coreza-backend/market-stream-service/src/services/MarketControlHandler.ts). On `dev`, the handler can return success after sending or queuing the subscription and recording routing state. Change that success condition to require gateway readiness for the current connection. Use the existing [stream registration route](../coreza-backend/src/routes/stream.ts) for listener startup and require live gateway state for Listen mode. Redis routing entries alone cannot confirm connectivity.
- For Alpaca market data, wait for the authentication success message and verify that the provider's subscription response includes the requested channels and symbols for the selected feed. Surface `402` as authentication rejection, `406` as a connection limit, and `409` as lack of access to the selected feed. [Alpaca WebSocket reference](https://docs.alpaca.markets/us/docs/streaming-market-data)
- Use the acknowledgment rules of the selected provider and stream type. For Dhan feeds without a positive acknowledgment, use the bounded observation window in the [Dhan stream startup plan](market-stream-listener-terminal-errors-plan.md). Require an open socket and a sent subscription where applicable, and fail on any provider error or early disconnect during that window. Report this as a connectivity check with the subscription sent. Reserve provider-confirmed status for explicit acknowledgments.
- Keep the node **Connecting** until the relevant checks pass. Bound the startup wait and report provider rejection, an early close, or a timeout in the node output. Do not wait for the first tick or candle. Discard late results after timeout and clean up only the subscriptions or routing acquired by the failed attempt. Keep the saved credential available for retry or use with another feed.

## Scope

Limit the change to the existing API-key credential Connect flow and broker subscription and listener startup. Keep WebSocket checks on the startup path, with no extra work per tick. Reuse the existing routes, gateway, and UI status handling. OAuth credential creation, order permission checks, migrations, and testing are outside scope.
