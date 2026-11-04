# Dhan credential and editor stream startup

Connect validates a numeric Client ID, an Access Token (`api_key` in the stored schema), and an explicit `live` or `sandbox` environment. An optional numeric Client ID claim in a JWT only detects mismatches; it does not authenticate the token.

The bounded read-only credential check uses `GET /v2/fundlimit` for both environments. It verifies the Client ID returned by Dhan and does not require a market-data subscription. Credentials are saved only after success. Failed updates preserve the existing record. Successful storage uses the existing credential-cache invalidation and records a new opaque revision. Dhan listener startup bypasses credential caches to observe replacements across processes.

Sources for the endpoint choice:

- [Dhan funds documentation](https://dhanhq.co/docs/v2/funds/) documents `GET /fundlimit` and the returned Client ID.
- [Dhan sandbox support discussion](https://madefortrade.in/t/facing-500-error-for-get-fund-limit-details-sandbox/54448) confirms `/v2/fundlimit` in sandbox, including outside market hours.
- [Dhan market-feed documentation](https://dhanhq.co/docs/v2/live-market-feed/) documents the live WebSocket endpoint and binary disconnect packets.
- [Dhan order-update documentation](https://dhanhq.co/docs/v2/order-update/) documents the order-update login message and live endpoint.

There is no assumed sandbox market-feed endpoint. Configure `DHAN_SANDBOX_MARKET_WS_URL` in the market-stream service only with an endpoint confirmed by Dhan for that environment. An unset value fails that feed explicitly; sandbox credentials are never silently sent to the live market host. Sandbox order updates independently require `DHAN_SANDBOX_ORDER_WS_URL`; their support is not inferred from a working market feed or account check. REST and WebSocket overrides require HTTPS and WSS respectively, without embedded credentials or query strings.

A successful Connect checks the account endpoint, not feed entitlement. Editor startup tracks its attempt before opening a gateway, shares an existing healthy connection only for the same user, credential revision, environment, and feed, and sends requested subscriptions on that connection. Dhan provides no explicit acknowledgment used by this adapter, so startup observes the subscribed socket for two seconds. A quiet feed can pass; this is logged as observation rather than provider-confirmed authentication. Immediate closes retain the existing retry policy. Startup, including retries and companion feeds, has one two-minute budget.

Listen validates current native subscriptions against the matching gateway. All required feeds must pass startup and routing registration before Listening. Startup failure is retained per attempt and uses the existing durable manual cleanup path. Cleanup releases only that attempt's ownership, preserving other manual listeners, live workflow ownership, and subscriptions that Listen consumes.

No tests, builds, or live credential checks were run while implementing this change, as requested.
