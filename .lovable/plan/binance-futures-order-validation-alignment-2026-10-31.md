# Binance USDⓈ-M Futures order form and payload validation alignment

**Date:** 2026-10-31  
**Branch:** `dev`  
**Status:** Implementation plan only — no production code changes  
**Scope:** Coreza Binance Futures Trade node, payload construction and live/manual execution paths. Do not modify Spot, other brokers, order endpoints, or normal order execution semantics.

## 1. Objective

Make the seven existing Binance USDⓈ-M Futures order types behave consistently across editor visibility, manual validation, live/queued execution, and broker-side payload validation. Prefer small local changes, not a new form system or trading-engine refactor.

The seven types already map correctly:
- Standard `/fapi/v1/order`: `MARKET`, `LIMIT`.
- Conditional `/fapi/v1/algoOrder`: `STOP`, `TAKE_PROFIT`, `STOP_MARKET`, `TAKE_PROFIT_MARKET`, `TRAILING_STOP_MARKET`.

Do not change these labels, values, or endpoint routing.

## 2. Evidence in current dev

- `src/nodes/Binance.json` already conditionally displays Futures `price`, `stopPrice`, `timeInForce`, `priceMatch`, `closePosition`, `activationPrice`, `callbackRate` and Client Algo ID. The Client Algo ID visibility was previously corrected to conditional order placement and Futures cancellation.
- `src/utils/fieldVisibility.ts` evaluates `displayOptions.show` with AND across dependency keys, and `displayOptions.hide` with OR; `shouldIncludeFieldInPayload` is available.
- `src/hooks/useNodeExecution.ts` filters hidden fields during manual payload creation (around lines 222–240) and validates fields declared `required` using inclusion rules (around lines 479–499).
- `coreza-backend/src/brokers/binance/http/operations.ts` separates standard and algo payload builders, rejects incompatible `closePosition + quantity`, `closePosition + reduceOnly`, and `price + priceMatch`; requires triggers and priced conditional order attributes; requires exactly one of quantity and closePosition for STOP_MARKET/TAKE_PROFIT_MARKET.
- In the `TRAILING_STOP_MARKET` branch, `callbackRate` is required but `quantity` is merely sent when truthy: missing quantity can reach Binance.
- `reduceOnly` is forwarded whenever not undefined, including false; Binance documents that reduceOnly cannot be sent in Hedge Mode.
- The trailing stop callback range is not locally validated in the broker payload builder.
- `coreza-backend/tests/binanceOrderPayload.test.ts` already has payload tests; extend it rather than introducing a parallel test harness.

## 3. Binance rules and intended UI/payload matrix

| Futures order | Quantity | Limit price / priceMatch | Trigger (UI stopPrice -> API triggerPrice) | Time in force | Other |
|---|---|---|---|---|---|
| MARKET | Required | Omit | Omit | Omit | Standard order |
| LIMIT | Required | Exactly one of price or priceMatch | Omit | Applicable (GTC default) | Standard order |
| STOP | Required | Exactly one of price or priceMatch | Required | Applicable | Conditional |
| TAKE_PROFIT | Required | Exactly one of price or priceMatch | Required | Applicable | Conditional |
| STOP_MARKET | Required unless closePosition=true | Omit | Required | Omit | closePosition permitted |
| TAKE_PROFIT_MARKET | Required unless closePosition=true | Omit | Required | Omit | closePosition permitted |
| TRAILING_STOP_MARKET | Required | Omit | Omit | Omit | callbackRate required; activatePrice optional |

- `callbackRate` must be numeric and within Binance's 0.1–10 percent range (inclusive).
- For `closePosition=true`, do not send `quantity` or `reduceOnly`. Backend must still reject conflicts if supplied by external callers.
- Position-side rules depend on account **position mode**, not just the selected `positionSide`. One-way uses BOTH; Hedge Mode uses LONG/SHORT and prohibits `reduceOnly`. Avoid inferring Hedge Mode from a UI value alone without checking how account mode is resolved.
- Respect Binance constraints for `closePosition` direction/positionSide in Hedge Mode and `reduceOnly` in Hedge Mode; guard or omit as dictated by confirmed account mode, never silently reinterpret intended position-closing behavior.
- `priceMatch` is an alternative to price where supported; do **not** statically make `price` required for LIMIT/STOP/TAKE_PROFIT, or valid priceMatch-only orders will be rejected.
- `clientAlgoId` is optional; keep automatic idempotency fallback and distinct standard-vs-algo order IDs.

Official references (review again at implementation time, since API contracts change):
- https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade
- https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Algo-Order
- https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order

## 4. Classification of gaps and risk

### A — Confirmed backend defect: trailing stop quantity

**Current:** `buildAlgoFuturesPayload` checks callbackRate and conditionally assigns quantity, without requiring quantity.

**Fix:** Reject missing/empty `quantity` for `TRAILING_STOP_MARKET`; maintain existing rejection of closePosition, stopPrice, price/priceMatch and TIF. Validate quantity with the existing broker numeric-validation convention; avoid duplicating exchange lot-size/filter logic.

### B — Confirmed validation gap: callbackRate bounds

**Current:** Presence validation only.

**Fix:** Parse to a finite numeric value, require `0.1 <= callbackRate <= 10`, and preserve the original accepted value serialization. Reject NaN, nonnumeric, zero, negative and out-of-range values before network dispatch. Make frontend error understandable; do not rely solely on placeholder text.

### C — UI early validation inconsistency (not missing backend validation)

**Current:** conditional `stopPrice`, `callbackRate`, and `price` are not declared `required`, although conditional backend checks apply. Manual generic validation checks `f.required`; therefore many mistakes only fail later in backend.

**Fix:** Prefer a **small Binance-Futures-specific cross-field validator** in the existing manual execution validation path or reusable broker-aware validation utility. It must validate the exact order-type matrix and `price OR priceMatch` rule. Do not mark all `price` fields required in JSON: priceMatch-only orders must remain valid. UI feedback should identify the missing combination clearly and focus the relevant field if existing UX permits. Preserve expression fields, evaluating after expression resolution where appropriate.

### D — Potential live workflow issue: hidden/stale field leakage (verify first)

**Current:** Manual execution filters hidden fields through `shouldIncludeFieldInPayload`. Live runtime/compiled execution field pruning has not been proven equivalent.

**Investigate:** Trace editor saved node values -> workflow serialization -> live runner -> `BrokerExecutor` parameter resolution -> Binance operation `makeParams`. Check whether a previously entered `quantity` remains when `closePosition` is toggled, or a previously selected price/stopPrice/TIF survives order-type changes. Probe real manual and live paths, not only the JSON visibility helper.

**Fix only if reproduced:** At the narrowest common Binance Futures payload-construction point, omit stale irrelevant fields from the final request while retaining rejection of safety-critical conflicting user intent. Specifically never silently remove a conflicting quantity if it could mask an incorrect close-position instruction; return a clear error unless the UI execution path explicitly and safely excludes the now-hidden field. Keep ownership and idempotency behavior unaffected.

### E — Binance Hedge Mode compatibility: reduceOnly

**Current:** `reduceOnly` is passed when not undefined, even if `false`; UI also displays it for all Futures order types.

**Fix strategy:** Determine how Coreza obtains or can reuse actual Futures position mode from account/broker config; avoid a synchronous account-mode API request per tick/order. In confirmed Hedge Mode, omit `reduceOnly` entirely when false; reject true with an actionable message. In One-way Mode, preserve intentional supported reduceOnly behavior. For `closePosition=true`, never send reduceOnly. If account mode cannot be established confidently, prefer fail-closed for a true value rather than guessing and modifying execution semantics. Verify positionSide compatibility and existing account-mode caching path; do not introduce a per-order DB or broker lookup.

### F — Conditional response validation / normalization (verification only)

Verify `newOrderRespType` accepted/sent values on the algo endpoint and that `algoId` vs `orderId` are distinct in the resulting lifecycle. Do not change identifiers, registration, order history or cancellation without proving a real defect. This is a narrowly scoped acceptance check, not a proposed refactor.

## 5. Implementation steps — minimal changes

1. **Recheck API + repository baseline** at the time of implementation. Confirm `dev` SHA, exact Binance conditional parameter schema and current behavior; ensure no existing equivalent validators have been added.
2. **Backend hardening** in `coreza-backend/src/brokers/binance/http/operations.ts`: require trailing stop quantity and validate callback range. Implement mode-aware reduceOnly handling using existing account-mode context if available; no per-tick network fetch. Keep existing field conflict guards.
3. **Frontend validation** in existing execution/field validation utility: add a Binance Futures order-type matrix and combined-field checks. Use currently resolved payload inputs, not only raw unresolved expressions. Reuse generic field messages where possible; no new UI architecture.
4. **Live path trace** through workflow storage and `BrokerExecutor`; update only if an actual mismatch is found. Ensure old saved nodes continue working with compatible values.
5. **Focused checks** extend `coreza-backend/tests/binanceOrderPayload.test.ts` and relevant field visibility/manual execution tests; verify no regression to Spot and ordinary MARKET/LIMIT.
6. **Documentation** add small inline explanations for mutually exclusive price/priceMatch, Close Position vs Quantity, and Hedge Mode reduceOnly if needed, without overcrowding node form.

## 6. Acceptance cases

- MARKET and LIMIT use standard endpoint; all five conditional types use algo endpoint.
- STOP and TAKE_PROFIT require trigger plus one of price or priceMatch, never both.
- STOP_MARKET and TAKE_PROFIT_MARKET require trigger plus either quantity or closePosition=true, never both.
- TRAILING_STOP_MARKET rejects no quantity; accepts positive quantity and callbackRate at 0.1 and 10; rejects 0, 10.1, NaN, missing callbackRate and unsupported fields.
- When closePosition is selected, Quantity is hidden in UI, excluded by manual payload filtering, and backend rejects explicit quantity+closePosition in direct/live requests.
- Hedge Mode test proves reduceOnly is absent even when the UI's default is false; true is safely rejected; One-way Mode preserves valid reduceOnly.
- Switching order type after entering a stopPrice/limitPrice does not generate invalid requests; check both manual and live runs, including previously saved workflow nodes.
- Client Algo ID visible for Futures conditional placement/cancellation only; automatic idempotency still used when blank.
- No added per-tick DB/Redis/broker requests, no extra hot-path awaits, no unintended change to order ownership, reconciliation or lifecycle.
- Manual and live paths report errors before sending invalid orders; error text identifies the missing or conflicting parameter.
- Existing `binanceOrderPayload.test.ts` remains green; test isolated payload construction without placing real orders. Optional end-to-end tests should use Futures testnet only.

## 7. Scope / rollback

**No:** architecture overhaul, generic node framework refactor, new DB tables, new Redis keys, retry/replay semantics changes, mandatory new market API calls, account-mode guesses, endpoint additions, Spot behavior changes.

**Rollback:** revert the small frontend validator and payload-builder commits; the existing Binance routing, order type IDs and Client Algo ID change stay intact.

## 8. Suggested implementation file touchpoints

- `src/nodes/Binance.json` — descriptions/visibility only if needed, not blanket `required` flags.
- `src/hooks/useNodeExecution.ts` or its existing shared validator — early manual validation.
- `src/utils/fieldVisibility.ts` — inspect, only edit if a demonstrated issue.
- `coreza-backend/src/brokers/binance/http/operations.ts` — payload assertions and Hedge Mode param handling.
- `coreza-backend/src/nodes/executors/BrokerExecutor.ts` and live runner — inspect, modify only for demonstrated mismatch.
- `coreza-backend/tests/binanceOrderPayload.test.ts` — expand focused cases.

**Deliverable:** targeted backend and frontend validation parity, tested against standard/conditional order matrix, with no measurable hot-path regression.
