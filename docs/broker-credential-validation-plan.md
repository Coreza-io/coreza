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

## Scope

Apply this to new API-key broker submissions through the existing Connect action. OAuth, non-broker credential flows, saved-credential reads, and workflow execution are outside this change. An account check verifies account API access. Market-data subscriptions, WebSocket connectivity, and order permissions are separate. No new endpoint, migration, or testing work is in scope.
