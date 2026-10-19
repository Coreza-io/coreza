# Coreza AI Agent — Historical Candle Range and Insufficient-History Recovery Plan

**Repository:** Coreza-io/coreza  
**Branch:** `dev` only  
**Status:** Plan only; no implementation changes in this commit  
**Objective:** Make the AI Agent request enough historical candles for its connected indicators, recognize insufficient warm-up data, and optionally recover with a bounded additional request, without hardcoding Alpaca behavior or altering live/backtest hot paths.

## Evidence from the debug run

The request to the configured `Alpaca_Hist_Bars` node was:
- AI-generated: `symbol: XAR`, `interval: 1Day`, `limit: "120"`.
- Configured: `operation: get_candle`, `feed: iex`, `sort: asc`, `assetType: stock`, `adjustment: raw`, `currency: USD`.
- Actual HTTP query: `symbols=XAR&timeframe=1Day&feed=iex&sort=asc&limit=120&adjustment=raw&currency=USD`.
- **No explicit `start` or `end` was supplied**. The broker returned `rawRowCount: 1`; downstream transformed, normalized, stored and indicator counts all remained one.
- EMA(20) required 20 bars, RSI(20) required 21, MACD(12,26,9) required 35. VWAP reported ready with one daily candle, which is not evidence of robust intraday VWAP analysis.
- The tool name `alpaca_2` is not the displayed `Alpaca_Hist_Bars` node name; these identifiers must remain distinct.

**Interpretation:** The missing date boundaries are a leading cause of the unexpectedly small historical result, but the exact broker default range is not established solely by the logs. `limit` is an upper bound, not a guarantee of 120 rows. Do not assert a normalization defect: the actual HTTP response count was already one.

## Existing functionality to retain

`AIAgentExecutor.ts` already:
- supplies historical `dataRef` guidance in the agent system message;
- creates LangChain tool schemas from node definitions;
- distinguishes generated/configured/effective inputs;
- emits `ToolExecution` traces for calls and outcomes.

`BrokerExecutor.ts` already uses config-driven `op.makeParams`, `op.makeBody`, pagination and the broker's existing capability adapters. It emits safe `http_request` / `http_effective_request` details at debug level.

`IndicatorsExecutor.ts` already logs `indicator_input`, count, warm-up readiness and calculation result. Do **not** create separate EMA/RSI/MACD logging or provider-specific indicator code.

## Phase 1 — Establish the historical operation's date/range semantics

Before changing logic:
1. Inspect the configured broker capability and node-definition schemas for `get_candle` / historical operations for Alpaca, Schwab, Dhan and Binance. Record names, types, supported defaults, accepted start/end units, `limit` behavior, maximum page size and pagination semantics.
2. Verify whether current code passes dates unchanged, supplies defaults, or derives them for any provider. Avoid assuming all brokers support identical parameters.
3. Confirm where the agent can discover available fields: tool description, generated Zod schema, node definition and system instruction.
4. Confirm warm-up requirements are exposed by existing indicator code (`requiredWarmupBars` or equivalent) and distinguish *bars required for calculation* from *additional context wanted by the user*.
5. Document how `1Day`, `1h`, etc. translate to an appropriate calendar lookback; avoid assuming daily candles exist on weekends or trading holidays.

**Deliverable:** validated historical-tool capability contract and existing readiness semantics, with no new broker-specific assumptions in the generic AI Agent.

## Phase 2 — Improve tool descriptions and agent instructions

**Primary file:** `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` (reuse the existing description-generation path).

Append concise guidance only for tools identified via historical-market-data capabilities/operation, not for all broker operations:
- When requesting history for indicators, supply supported **explicit start/end boundaries** or the provider's documented count-based latest-history mode.
- `limit` bounds the returned rows; it does not necessarily fetch the latest N bars.
- Choose a sufficient range for indicator warm-up and the requested analysis horizon.
- Never invent a valid trading day or infer missing data values; explain when history is not sufficient.
- Use the exact returned `dataRef` downstream and do not confuse a generated tool name with a storage key.
- Honor fixed node settings. Do not ask the model for fields omitted by the tool schema.

The description should expose the *actual valid field names* (e.g. `interval` versus `timeframe`) based on the registered tool, rather than inventing a universal schema. Where the user explicitly asks for only the most recent/current candle, do not force an unnecessary long-range fetch.

**Deliverable:** the LLM knows when/how to request sufficient history using the connected broker's schema.

## Phase 3 — Validate effective historical input without rewriting requests

Place the validation at the existing generic historical tool / broker boundary **after** generated and fixed inputs have been merged and resolved and **before** sending a request. Validation should be capability-driven.

- Validate supplied date format, start <= end, supported interval, and broker-adapter constraints.
- Recognize both explicit-date and supported count-based history modes.
- If the request lacks a usable range but the broker supports omitted dates, **do not unconditionally block it**. Emit a structured `history_coverage_uncertain` diagnostic when an indicator-based analysis appears to need more data.
- Preserve all existing configured field precedence, expression evaluation, request params, order handling and pagination.
- If no historical mode can retrieve sufficient bars with provided fields, return an actionable validation error rather than guessing parameters.
- Never apply historical-lookback validation to quotes, trades, account operations, or order placement.

**Deliverable:** malformed inputs are diagnosed early while valid provider-specific history requests continue to work.

## Phase 4 — Readiness-aware, bounded recovery

Prefer the **AI Agent orchestrating** one additional historical fetch via its existing connected tool. Do not make `IndicatorsExecutor` call brokers.

1. Use actual `rowCount` and the configured indicators' existing `observedBars`, `requiredBars`, `isReady` outcomes.
2. If a required indicator is not ready because history is short, provide a small structured context to the agent: `symbol`, `timeframe`, `receivedBars`, `requiredBars`, `dataRef`, source tool identity and recoverability.
3. Where the agent can use the historical tool again, request a broader supported date interval, taking into account trading calendars, sessions, the provider's data availability, and configured API limits. Use a conservative buffer without promising an exact bar count.
4. **Bound retries** (initial suggested default: one additional fetch per symbol/timeframe per agent run; make configurable only if Coreza already has an appropriate policy). Also honor existing agent `maxIterations`, abort signals, request budgets, rate limits and provider/API constraints.
5. Use the **new returned `dataRef`**; only recompute dependent indicators using the newly fetched candles. Do not mistakenly keep using the earlier one-row dataRef.
6. Avoid retries for a true empty/non-trading asset, missing permissions/entitlements, API errors, user-requested one-bar tasks, or inherently unavailable history.
7. If recovery cannot obtain enough history, stop and report not-ready honestly. Never silently transform `isReady:false` into a successful technical signal.
8. Avoid automatic retry loops in live/backtest tick paths. Any recovery logic is for agent-managed historical analysis, not streaming execution.

If reliable provider-aware lookback calculation is not already available, implement the minimum capability-aware heuristic rather than creating a new universal market-calendar engine. Keep it separate from indicator calculations.

**Deliverable:** no repeated one-bar forecasts where a bounded valid historical fetch could satisfy required warm-up.

## Phase 5 — Retain and extend structured logging only where necessary

**Do not rebuild existing indicator parameter logging.** Debug logs already capture:
- `generated_input`, `validated_input`, `configured_input`, `effective_input` for EMA/RSI/MACD/VWAP;
- `indicator_input`, `resolve_candles`, `indicator_compute`, result status and `tool_completed`;
- EMA window=20; RSI window=20; MACD fast=12/slow=26/signal=9; VWAP session_type=daily.

The existing `ToolExecution` logger also records the broker's final HTTP query at debug level. Keep credential redaction in place.

Add only focused history/recovery event fields:
- `history_coverage`: source tool invocation ID, symbol, interval, requested start/end **when present**, limit, raw/normalized count, observed max requirement;
- `history_recovery_decision`: reason, selected supported range mode, attempt number, additional fetch allowed/denied and why;
- `history_recovery_result`: new invocation ID and dataRef, received count, readiness;
- `history_recovery_stopped`: budget, availability, permission or insufficient-data reason.

Emit compact non-sensitive summaries at info, request parameters at debug. Do not dump raw price arrays, prompts, API keys, signed URLs or credentials. Correlate by run ID and invocation IDs. Ensure logging never changes request execution.

## Implementation sequence

1. Inspect provider historical capability contracts and shared indicator warm-up requirements.
2. Add precise historical-range guidance to only applicable tool schemas/descriptions and the generic agent system instruction.
3. Add capability-aware input validation/coverage diagnostics using existing resolved parameters.
4. Add (or enable) one bounded agent-level historical retry using the registered historical tool and exact new DataRef.
5. Preserve all current tool/indicator logs; extend only coverage and retry reason visibility.
6. Review behavior on a normal history request, short history, provider without date support, multi-symbol/multi-timeframe requests, cancellation and live/backtest isolation. This is a targeted verification checklist, **not a separate end-to-end regression-test phase**.

## Expected files / scope

| File | Change |
|---|---|
| `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` | Capability-aware tool guidance, insufficient-history response and bounded agent recovery orchestration |
| Existing broker capability definitions / node metadata | Reuse available historical parameter semantics, extend only if necessary |
| `coreza-backend/src/nodes/executors/BrokerExecutor.ts` | Minimal input validation / history coverage signals if generic boundary cannot provide them |
| Existing tool logging utility | Optional compact recovery decision/result events |
| `IndicatorsExecutor.ts` | **Prefer unchanged**: use its existing readiness and parameter logs |

**Do not alter** unrelated broker operations, API behavior, indicator math, chart UI, regular Execute All, live or backtest tick processing.

## Acceptance criteria

- With a connected historical tool and sufficient provider history, an agent asked to compute EMA/RSI/MACD asks for or recovers a suitable historical range rather than relying on `limit` alone.
- Valid provider-specific count-only request modes remain valid.
- Short history does not produce fabricated or confidently interpreted unavailable indicators.
- Tool dataRefs remain per-invocation and resolve to the intended symbol/timeframe.
- Debug logs retain complete *safe* generated/configured/effective inputs for broker and indicator tools; info logs remain succinct.
- Recovery is bounded, cancellable, rate-limit-aware and does not run in live/backtest critical paths.
- `dev` only; `main` untouched. This document does not implement code.
