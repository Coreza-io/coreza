# Coreza AI Agent — Generic Broker-to-Indicator Data Pipeline Fix Plan

**Repository:** Coreza-io/coreza  
**Target branch:** `dev` only  
**Status:** Planning only; do not implement as part of this change  
**Scope:** Repair the AI Agent's market-data references, generic OHLCV normalization, indicator input handling, validation and execution observability. Keep changes minimal.

## Goal

Make AI Agent tool execution reliably pass historical OHLCV market data from **Alpaca, Schwab, Dhan, Binance and future brokers** to **EMA, RSI, MACD, VWAP and other indicators**, without embedding provider-specific logic in `IndicatorsExecutor`. Preserve direct workflow, Execute All, backtest and live execution semantics and avoid per-tick network/storage overhead.

## Background and observed symptoms

In an AI Agent run, Alpaca's historical bars operation reported success but logs showed:

```text
[ToolProcessor] dataRef not found: alpaca_2
[Indicators] Resolving dataRef: 1 bars
Executing ema indicator with 0 data points
Executing rsi indicator with 0 data points
Executing macd indicator with 0 data points
Executing vwap indicator with 0 data points
```

The visible node name was `Alpaca_Hist_Bars`; `alpaca_2` is not its displayed name. In `AIAgentExecutor.ts`, `getToolName()` can use `toolMetadata.name`, and dynamically generated tool names can have numeric suffixes. Confirm the exact origin of `alpaca_2` before changing naming. A tool ID is **not** automatically a DataContext key.

Related code:
- `coreza-backend/src/nodes/logic/toolOutputProcessor.ts`: `extractBars()`, `processToolOutput()`, `resolveDataRef()`, `extractPrices()`.
- `coreza-backend/src/nodes/executors/AIAgentExecutor.ts`: dynamic tool creation, input resolution, tool result processing and serialization.
- `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts`: sync/async candle parsing, indicator parameter preparation and indicator service call.
- `coreza-backend/src/engine/DataContext.ts`: `setData()`, `getDataByKey()`, run-scoped storage.

Observed `0 data points` may indicate missing derived price fields, not necessarily zero source candles. The original `1 bars` log might be a wrapper object and must not be treated as proof of a single valid candle. The missing "Stored X bars" log suggests normalization/storage did not take the expected path but is not conclusive by itself. The HTTP 200 response is not proof of valid indicator results.

## Design rules

1. **Provider-agnostic indicator boundary.** Normalize upstream; never add branches such as `if (broker === 'Alpaca')` in indicators.
2. **Reuse existing canonical market-data types/adapters** if Coreza already has them. Do not introduce a duplicate OHLCV contract.
3. **Reference integrity.** The tool name, node ID, invocation ID and storage `dataRef` are different identifiers.
4. **Explicit failures.** Do not silently supply zero prices, fabricate bar data, or report successful calculations for missing data.
5. **Minimal footprint.** Reuse `DataContext`, existing node results, indicator service contracts and current broker implementations. No frontend redesign.
6. **Execution efficiency.** Normalize historical arrays once per fetched result; no added Redis/PostgreSQL/API reads or full-history reparsing on every live tick.
7. **Multi-symbol safety.** A reference must identify the correct invocation, symbol and timeframe, and be scoped to the current run.
8. **No unrelated operations.** Broker account/order/position/quote outputs must not be mistaken for historical candles.

## Phase 1 — Audit existing contracts and choose canonical OHLCV representation

Before editing, inspect the real Alpaca, Schwab, Dhan and Binance historical-bar output paths and any shared market-data converters in `dev`. Identify each executor's `result.data` shape, including cases such as a direct array, `{bars: [...]}`, symbol-keyed `{bars: {AAPL: [...]}}`, and column arrays.

Prefer Coreza's existing typed candle shape. If none is reusable, define one small shared contract:

```typescript
interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  endTimestamp?: string;
}
```

Requirements:
- Convert provider shorthand `t/o/h/l/c/v` and long field names only within the normalization boundary.
- Convert timestamps with unit-awareness; preserve timezones/UTC and available `endTimestamp`, never invent an end time.
- Ensure numbers are finite; ensure OHLC consistency and chronological ordering.
- Preserve valid zero volume; reject unavailable price values rather than defaulting to zero.
- Do not flatten multi-symbol data into one unlabeled series. Require/resolve the requested symbol or return an explicit ambiguity error.
- Preserve metadata such as symbol, timeframe, provider and source operation separately.
- Preserve correct ordering and avoid accidental mutation of source/cached arrays.

**Deliverable:** one clearly identified shared OHLCV contract and an audit of producer/consumer shapes.

## Phase 2 — Generic market-data extraction, normalization and storage

**Primary file:** `coreza-backend/src/nodes/logic/toolOutputProcessor.ts` (or an existing shared normalizer reused from the market data layer).

Current `extractBars()` recognizes direct arrays and selected array-valued properties. Extend/reuse generic extraction to handle supported nested/symbol-keyed formats **without assuming the broker name**. For a broker-specific columnar representation, use an adapter at the broker boundary rather than bloating `IndicatorsExecutor`.

Suggested API (illustrative, adapt to established types):

```typescript
const normalized = normalizeHistoricalCandles(result.data, {
  symbol: requestedSymbol,
  timeframe: requestedTimeframe,
  source: providerId,
});
```

Only invoke normalization for verified historical OHLCV operations. Distinguish a valid empty dataset from unsupported/malformed payloads.

When normalized candles exist:
- Store **one canonical series** using the existing `dataContext.setData(key, candles, metadata)`.
- Return the actual `dataRef.ref`, `rowCount`, metadata and compact market-data summary from `processToolOutput()`.
- Keep raw arrays out of the LLM tool result when a reference suffices.
- Reuse existing storage constraints, memory limits and cleanup.
- If no valid candles are available, return a structured no-data/error result rather than a success-looking generic passthrough.
- Avoid converting unrelated broker capabilities (trades, orders, balances) into candles.

Example tool output (illustrative):

```json
{
  "type": "market_data",
  "dataRef": "bars:ARKX:1h:<unique-run-key>",
  "rowCount": 200,
  "summary": {"symbol": "ARKX", "timeframe": "1h"}
}
```

**Deliverable:** stable provider-agnostic market-data output and actual stored key.

## Phase 3 — Repair tool-to-DataRef resolution

**Primary files:** `AIAgentExecutor.ts` and `toolOutputProcessor.ts`.

Problem: `resolveDataRef()` directly calls `dataContext.getDataByKey(input.dataRef)`. An AI-generated string such as `alpaca_2` may identify a tool rather than the stored bar series. A tool ID must never be blindly accepted as a storage key.

Preferred path:
1. A historical market-data tool returns its explicit `dataRef`.
2. The LLM passes that exact reference to downstream indicator tools.
3. The resolver checks only existing, authorized, run-scoped storage keys.
4. If tool-name aliases are necessary for backwards compatibility, maintain a **run-scoped invocation-output registry** mapping tool invocation ID -> concrete `dataRef`, with tool-name alias lookup only when unambiguous.
5. Multiple calls to one tool must be distinguishable. Do not map a bare tool name to "last bars" if several symbols/timeframes/invocations exist.
6. Validate access and data type to prevent cross-run lookup and accidental use of a reference to an unrelated result.
7. On failed resolution, stop the dependent calculation with a structured tool error; do not parse `alpaca_2` as JSON or reinterpret it as one candle.

Illustrative resolver:

```typescript
function resolveMarketDataRef(ref: string, context: AgentToolContext): MarketCandle[] {
  const storageKey = context.invocationRefs.resolveUnambiguously(ref) ?? ref;
  const candles = context.dataContext.getDataByKey(storageKey);
  if (!isCanonicalCandleArray(candles)) {
    throw new Error(`Market-data reference unavailable or invalid: ${ref}`);
  }
  return candles;
}
```

Adapt this pseudo-code to Coreza's existing tool schemas and lifetime management. Do not introduce persistent global registries; clean run-scoped mappings with the AI Agent context.

**Deliverable:** a tool invocation or true `dataRef` reaches the intended historical candles unambiguously.

## Phase 4 — Make indicator inputs generic and consistent

**Primary file:** `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts`.

Both synchronous and asynchronous paths currently perform their own `candle_data` parsing/conversion. Extract a small shared input resolver that accepts:
- A genuine run-scoped DataContext `dataRef`.
- A canonical candle array.
- A supported preexisting direct candle object or JSON representation.
- Non-agent workflow execution with no DataContext.

If reference input is used, validate it **before** any `JSON.parse` fallback. Do not turn an arbitrary object with a `dataRef` field into a single candle. Reject malformed/ambiguous formats explicitly.

Illustrative usage:

```typescript
const candles = resolveIndicatorCandles(resolvedParams, context);
const processedParams = {
  ...resolvedParams,
  candle_data: candles,
};
```

Keep broker-specific parsing out of `IndicatorsExecutor`. Inspect `IndicatorService.calculate()` and its indicator-specific contracts before restoring commented-out fields. Where needed, derive close-price arrays from normalized candles:

```typescript
const closePrices = candles.map(c => c.close);
// Populate only the fields actually required by each indicator contract.
```

Respect user-specified source/price fields and avoid overriding valid explicitly supplied inputs. Confirm `EMA`, `RSI`, `MACD`, `SMA`, `BB` inputs receive their configured price series; `VWAP`, `ATR`, `ADX`, `OBV` and other OHLCV indicators receive the fields required by their existing algorithms.

Ensure sync, async, Execute All, backtest, and live call paths consume the same format without unnecessary copies. In the live hot path, use the existing warmed indicator state and append/update only new bars; do not remap full history every tick.

**Deliverable:** indicators operate on `MarketCandle[]` regardless of provider or agent involvement.

## Phase 5 — Meaningful validation, readiness and error propagation

Missing data, insufficient history and a valid calculation are **different outcomes**:

| Condition | Required behavior |
|---|---|
| No DataRef / unresolved reference / malformed candles | Explicit tool failure with safe, actionable message |
| Valid candles, not enough warm-up | Not-ready outcome with observed/required bars, not fabricated zero |
| Sufficient canonical candles | Verified calculated values with appropriate metadata |

- Use the existing `requiredWarmupBars()` / indicator readiness logic; do not invent a universal period.
- Avoid interpreting an unavailable indicator as bearish/bullish or forwarding it to the LLM as a legitimate numeric signal.
- Ensure `AIAgentExecutor` conveys tool failures rather than treating textual `Error executing tool...` as a successfully calculated value.
- Distinguish successful broker HTTP transport from a valid candle dataset and successful final analytical result.
- Keep error objects backward compatible with Coreza's node result conventions.

**Deliverable:** agent conclusions cannot claim indicator confirmation from empty/invalid data.

## Phase 6 — Low-overhead logs and performance tracing

The captured `POST /aiagent/execute` completed in **523,788 ms** (roughly 8m44s), but the logs do not isolate where time was spent.

Add measured durations (no guessed performance assumptions) for:
- LLM planning/response and tool invocation cycles.
- Broker API fetch/pages.
- Normalization and row count.
- DataContext store and reference resolution.
- Indicator compute and readiness.
- Agent final response and cleanup.

Use `runId`, `toolInvocationId`, workflow node ID and dataRef (safely abbreviated as appropriate) to correlate events; avoid dumping candles, secrets or credentials. Keep frequent low-value pings at debug level and avoid noisy per-tick logs.

**Deliverable:** logs distinguish API latency, LLM iteration overhead, normalization errors and indicator computation latency.

## Expected code touch points

| Existing file | Intended edit |
|---|---|
| `coreza-backend/src/nodes/logic/toolOutputProcessor.ts` | Generic historical bars recognition, normalized storage, strict reference resolution |
| `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` | Reference handoff, run-scoped tool invocation mapping, error propagation and trace IDs |
| `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts` | Shared generic indicator candle resolution and minimal parameter mapping |
| Existing shared market-data utility/type | Reuse or minimally extend canonical candle adapter |
| `coreza-backend/src/engine/DataContext.ts` | **Prefer no change**; existing `setData/getDataByKey` should suffice |

No UI changes or broker-specific code in indicators. Avoid unrelated executor refactoring.

## Implementation sequence

1. Trace representative historical-bar outputs from Alpaca and Schwab (and known Dhan/Binance formats) through the existing adapters.
2. Select/reuse the canonical OHLCV representation and normalization boundary.
3. Make `processToolOutput()` identify and store canonical historical candles correctly.
4. Return true `dataRef` values and resolve unambiguous invocation aliases when necessary.
5. Consolidate indicator candle-input resolution across sync and async paths and supply each indicator's expected fields.
6. Make missing data, warm-up and calculation results explicit and observable.
7. Add low-overhead timing instrumentation and check that the normal workflow and live paths remain efficient.

## Acceptance conditions

- The AI Agent never treats a displayed node label or tool name as a valid DataContext key unless explicitly and unambiguously mapped.
- A historical output from Alpaca or Schwab yields the **same canonical candle shape**; other providers use that same interface.
- EMA/RSI/MACD/VWAP receive the intended validated values or an explicit missing-data/not-ready result.
- No fabricated zero prices, silent parse failures, multi-symbol mixing or cross-run references.
- Existing normal, Execute All, backtest and live paths retain their public contracts and performance characteristics.
- Only `dev` is targeted; no feature code is implemented as part of writing this plan.

**Excluded from this document by request:** a separate end-to-end regression-test phase. This plan is an implementation specification, not a code change.
