# Binance continuous-kline rollout and recovery

Deploy the backend API and market-stream-service builds together. Both accept
`continuousKline` and `continuous_kline`, and emit
`ethusdt_perpetual@continuousKline_1m`. Current and next quarter names retain
their full contract suffix. Monthly `1M` remains case-sensitive.

## Existing affected workflows

1. Stop the affected listener/workflow and its market subscription through the
   existing lifecycle APIs before deploying. Keep other workflows and companion
   trading subscriptions running when they do not share the affected connection.
2. Inspect only the affected user's gateway snapshot, workflow-scoped stream set,
   saved registration and test-listener records. Do not flush Redis or delete a
   shared gateway key. If the gateway is shared and lacks endpoint context,
   coordinate all workflows on that connection for stop and re-registration.
3. Deploy both packages and re-subscribe from authoritative node configuration
   with explicit Futures/testnet settings and the intended contract and interval.
   Re-registration replaces affected claims; it is not a startup migration.
4. Confirm the gateway subscription, workflow stream set and registration contain
   the same canonical name and no malformed claim for this workflow. Verify a
   closed candle reaches the existing BarSeries output, then stop/start the listener
   and restart the service to verify the saved context is retained.

Restore refuses to replay malformed continuous names, and skips affected saved
listener registrations with a diagnostic. Healthy stream claims on a gateway
with valid context can still restore. Binance snapshots without resolved
environment and marketType are not connected using an assumed Spot/live default;
re-register their affected workflows instead. Saved keys remain available for
inspection and scoped teardown; no automatic data migration or Redis deletion runs.

## Diagnostics and validation limits

Local subscription-result success confirms setup and persistence, not a broker
market SUBSCRIBE acknowledgement or first candle. Market acknowledgements and
rejections log source, request ID and broker code/message without credentials or
listen keys. A null result acknowledgement is never published as market data.
Market acknowledgements are not correlated to the API response in the existing
gateway design, so a later broker rejection is diagnostic, not retroactive API
failure. Private trading authentication and URLs are unchanged by this fix.

The existing normalization, closed-candle filtering and manual frontend delivery
paths remain in place. No live broker smoke check, deployment, tests or builds
were run for this change. Run the plan's acceptance checks before rollout; this
document does not claim a candle was received in a running environment.
