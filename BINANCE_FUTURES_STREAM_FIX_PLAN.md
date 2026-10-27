# Binance Futures continuous-kline stream fix plan

Branch: `dev`
Status: implementation plan only; runtime code has not been changed.
Date: 2026-10-27

## Problem and intended behavior

A Futures listener registers successfully inside Coreza but receives no candle output. The supplied logs show `ethusdt@continuousKline_1m` in the gateway subscription and workflow routing set. For a perpetual continuous contract, the canonical subscription and routing name must be `ethusdt_perpetual@continuousKline_1m`.

The same canonical name must survive backend request construction, market-stream subscription, Redis storage, event publication, workflow lookup, unsubscribe, and reconnection. Internal registration success is not proof of broker acknowledgement or first data receipt.

Reference: Binance USD-M Continuous Contract Kline/Candlestick Streams:
https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Continuous-Contract-Kline-Candlestick-Streams

## Confirmed findings on dev

1. `coreza-backend/market-stream-service/src/config/brokerStreamConfig.ts` normalizes both continuous-kline aliases to `continuousKline`, while `src/utils/streamName.ts` in the same service checks for `continuous_kline`. Its special branch is skipped, dropping the contract suffix.
2. `coreza-backend/src/brokers/binance/capabilities.ts` instead normalizes aliases to `continuous_kline` and emits that spelling in stream names, disagreeing with the broker-native name and normalized incoming event type.
3. Both stream parsers split type/interval at the first underscore. A legacy name such as `ethusdt_perpetual@continuous_kline_1m` becomes type `continuous` and interval `kline_1m`; the later continuous-kline check cannot recover it.
4. The service's `tests/streamNameBinanceAliases.test.ts` expects snake-case outbound names. These expectations must be corrected, not retained as the desired contract.
5. Incoming normalization in `marketGateways/binance/helpers.ts` already maps Binance's event token `continuous_kline` to Coreza's `continuousKline`, reads pair from `ps`, and carries `ct`, `k.i`, and `k.x`.
6. `MarketDataSubscriber.ts` reconstructs a continuous event routing name using symbol, contract type, normalized event type, and timeframe. A registration without the contract suffix will not match that name even if an event reaches the subscriber.
7. `MarketControlHandler.ts` restores previously saved stream strings directly. A restart alone can replay malformed subscriptions.
8. Gateway persistence currently omits environment and marketType even though restoration reads them. This is a related reconnect risk to address explicitly; the supplied log does not establish that the initial socket used the wrong endpoint.

## 1. Establish one naming contract

| Concern | Required representation |
| --- | --- |
| Accepted configuration aliases | `continuousKline`, `continuous_kline` |
| Binance incoming event token | `continuous_kline` |
| Coreza normalized event type | `continuousKline` |
| New outbound subscription and Redis routing name | `<pair>_<contractType>@continuousKline_<interval>` |
| Default contract when omitted by current configuration | `perpetual` |
| Explicit quarter contracts | Preserve `current_quarter` and `next_quarter` |
| Symbol and contract casing | Lowercase in stream names; normalized event symbol remains uppercase |
| Interval casing | Preserve exactly, including `1M` |

Example: ETHUSDT + continuous_kline + 1m + PERPETUAL produces `ethusdt_perpetual@continuousKline_1m`.

Require a nonempty interval for continuous klines in both builders. Normalize contract casing and preserve supported configured contract choices. Keep backward compatibility for existing aliases at input boundaries, while emitting only canonical names.

Use existing package boundaries. Prefer matching small broker-specific rules and parity fixtures across the two separately built services over importing backend internals into the stream service. Inspect generic capability-builder fallbacks and update any reachable Binance fallback so they cannot recreate the old format; avoid changing unrelated brokers.

## 2. Fix backend and market-stream builders and parsers

Primary files:

- `coreza-backend/market-stream-service/src/utils/streamName.ts`
- `coreza-backend/market-stream-service/src/config/brokerStreamConfig.ts`
- `coreza-backend/src/brokers/binance/capabilities.ts`

Audit callers/fallbacks:

- `coreza-backend/src/brokers/capabilities.ts`
- `coreza-backend/src/utils/streamName.ts`
- `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts`

Implementation steps:

1. Align the service's special-case check with canonical `continuousKline` and include the normalized contract suffix.
2. Make the backend Binance normalizer/builder emit the same canonical name.
3. Recognize continuous-kline prefixes before generic underscore splitting. Parse the interval after either complete prefix, rather than treating the underscore inside `continuous_kline` as an interval separator.
4. Separate pair from contract without losing underscores in quarter contract names.
5. Parse canonical names, legacy snake-case names, and the observed missing-contract name into consistent fields. Rebuild to canonical form where recovery is unambiguous.
6. Keep generic embedded-interval handling in sync with the new normalization. Verify subscribe and unsubscribe produce identical names from the same inputs.
7. Do not lowercase the complete stream string: `continuousKline` and monthly interval `1M` are case-sensitive.

## 3. Verify the complete event route

Inspect `marketGateways/binance/helpers.ts`, the gateway publisher, `MarketControlHandler.ts`, and `MarketDataSubscriber.ts`.

Trace a representative raw payload:

```json
{
  "e": "continuous_kline",
  "ps": "ETHUSDT",
  "ct": "PERPETUAL",
  "k": {
    "t": 0, "i": "1m", "x": true,
    "o": "1", "h": "2", "l": "1", "c": "2", "v": "3"
  }
}
```

Assert that publication and workflow lookup both use `ethusdt_perpetual@continuousKline_1m` and the listener receives its existing candle output structure.

Preserve current behavior: onlyClosedBars=true suppresses unfinished candles; isLive=false permits manual/frontend delivery; ORDER_TRADE_UPDATE remains an independent trading subscription. No order placement is required for candle validation.

Inspect combined-envelope handling if supported by the active gateway, but do not introduce an unrelated transport rewrite.

## 4. Recover existing subscriptions and preserve reconnect context

Use a controlled workflow-scoped recovery for the first rollout:

1. Stop the affected listener/workflow and its market subscription through existing lifecycle APIs.
2. Inspect the affected user's Binance gateway state, workflow stream set, persisted registration, and test-listener entries for malformed continuous-kline names.
3. Remove or rebuild only affected continuous-kline registrations through existing teardown/re-registration paths. Preserve other workflow subscriptions and companion trading streams. If shared gateway state prevents scoped cleanup, coordinate the affected workflows rather than deleting a shared key wholesale.
4. Deploy matching backend and stream-service builds, reconnect with explicit Futures/testnet context, and re-subscribe from node configuration.
5. Verify both gateway state and workflow routing sets contain the canonical name and no stale malformed claim for this workflow.

Do not flush Redis or invent a contract for ambiguous persisted state. Missing contract may default to perpetual only when configuration or the established default supports it; otherwise require re-registration from authoritative node configuration.

Persist the resolved environment, marketType, and relevant feed alongside gateway state, and restore them before connecting. For old snapshots without sufficient context, recover from authoritative configuration/credentials or invalidate that affected registration with a clear diagnostic rather than silently selecting Spot/live.

Automatic startup migration is optional follow-up work. If implemented, it must canonicalize gateway streams, per-workflow claims, routing sets, and listener registrations together, be idempotent, and complete before consumption resumes. Never normalize only the outbound WebSocket request while leaving Redis routing names unchanged.

## 5. Improve subscription diagnostics within the existing gateway design

Check existing subscription acknowledgement handling before adding new machinery.

- Log market SUBSCRIBE acknowledgements and broker error code/message with request ID and source, without credentials or listen keys.
- Keep local registration, broker acknowledgement, and first event receipt distinguishable.
- Do not interpret Binance's null result acknowledgement as a candle or as proof of eventual data receipt.
- Surface rejection or timeout through the existing subscription-result mechanism if its lifecycle supports acknowledgement correlation; otherwise document that its current success means local acceptance and expose broker failure separately.
- Avoid per-tick informational logging.

Endpoint selection is a validation checkpoint: confirm testnet + futures selects the intended Futures market socket. Do not change private user-data authentication or URLs solely because the market stream name is wrong.

## 6. Regression coverage

Update `coreza-backend/market-stream-service/tests/streamNameBinanceAliases.test.ts` and existing backend stream-name tests; add focused routing/recovery tests where needed.

| Scenario | Expected result |
| --- | --- |
| Either accepted alias, ETHUSDT, 1m, omitted contract | Canonical perpetual name |
| Mixed-case pair and contract input | Lowercase pair/contract, camel-case stream token |
| Current/next quarter | Full contract name retained |
| Canonical and legacy name parse/build round trips | Canonical result; correct interval and contract |
| Observed missing-contract name | Recover using established default/configuration |
| Monthly interval 1M | Remains 1M |
| Missing interval | Clear error in both builders |
| Backend vs service fixtures | Byte-identical generated names |
| Raw continuous_kline payload | Correct normalized event and matched workflow |
| Unclosed then closed candle | Closed-only listener receives only the closed event |
| Manual listener | Frontend delivery works with isLive=false |
| Unsubscribe, resubscribe, reconnect | Same canonical stream; no stale or duplicate claims |
| Persist/restore Futures testnet context | Same resolved endpoint context after reconnect |
| Broker acknowledgement and error | No accidental market-data publication; useful diagnostics |
| Spot kline and companion order events | Existing behavior preserved |

Include workflow/user isolation in the routing and recovery test. Use mocked transport and Redis for automated tests; do not place trades or call private live endpoints.

Run focused Jest tests and `npm run build` in both `coreza-backend` and `coreza-backend/market-stream-service`. Record unrelated pre-existing build/test failures separately rather than claiming a clean result.

## 7. Rollout and acceptance

1. Commit the implementation separately from this plan, based on dev.
2. Validate the unit/integration cases and build both affected packages.
3. Deploy both packages together and perform scoped re-registration.
4. Run an authorized Futures testnet manual-listener smoke check with ETHUSDT perpetual 1m, waiting through at least one candle boundary.
5. Confirm the exact canonical name in the outbound request, saved subscription, publish route, and workflow registration.
6. Confirm a closed candle reaches the listener, stop/start works, and restart retains Futures/testnet context.

Acceptance: the user's workflow receives continuous Futures candles, all naming boundaries agree, old names do not silently return on restart, and Spot/trading companion delivery remains intact.

Rollback: stop affected listeners, restore the paired previous builds, and re-register only with a known working supported stream configuration. Do not restore malformed subscriptions as if they were healthy.

## Scope

This change fixes continuous-kline subscription/routing consistency and the directly related recovery path. It does not redesign broker connections, alter fill accounting, change the node output schema, add database migrations, or repair unrelated Futures stream types. Any additional endpoint or gateway issue found during smoke testing must be reported with evidence.
