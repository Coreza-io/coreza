# Coreza AI Agent — Generic Tool Execution Logging Plan

**Repository:** Coreza-io/coreza  
**Target:** `dev` branch only  
**Status:** Plan only — do not implement code as part of this document  
**Goal:** For every AI Agent tool invocation, show *all applicable safe fields* the model supplied, values saved in the node, the final resolved inputs, and the actual effective request sent to a broker or external API. Correlate results and timings without leaking credentials or slowing live/backtest execution.

## Current findings (dev)

- `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` creates a dynamic tool and generates a `toolInvocationId`, logs phase durations, and merges LLM-generated arguments with configured node values. The current logs omit those parameter objects.
- Saved configured values override LLM-provided values; the expression resolver can change those saved values. The logger must distinguish **generated**, **configured**, **effective** and **transport** values rather than equating them.
- `coreza-backend/src/nodes/executors/BrokerExecutor.ts` resolves parameters, optionally normalizes crypto inputs, constructs `op.makeParams()` and `op.makeBody()`, and sends the request or uses `op.execute()`. The existing log gives the broker operation and URL but not the full effective parameters.
- The pagination path may modify the actual page query; capture the **actual per-page** values when verbose logging is enabled.
- The prior historical call stored just **one** daily XAR candle. This plan should reveal whether the agent specified a narrow history window, defaults constrained the request, the API returned a small response, or downstream transformation reduced it. Do not change history fetching semantics as part of logging.
- Tool identity and invocation identity are separate: e.g. displayed node `Alpaca_Hist_Bars`, generated tool name `alpaca_2`, and unique invocation ID.

## Design principles

1. Instrument **generic AI tool boundaries** instead of hardcoding Alpaca, Schwab, Dhan, Binance, RSI, MACD or other names.
2. Capture every **present, safely loggable** field, including dynamically defined node fields and future broker fields. Do not add a fixed schema that silently drops unknown fields.
3. Redact *before* serialization or logging; never print unsanitized originals beside sanitized copies.
4. Prefer existing structured logger and the current `agentDataTrace` correlation mechanism.
5. Avoid expensive cloning, JSON stringify and verbose payload inspection in the live/backtest hot path unless debug logging is enabled.
6. Preserve existing tool input precedence, expression behavior, broker request building, pagination and executions exactly.
7. Log helpful **summaries**, not full candle arrays, credential objects, arbitrary HTTP response bodies or full model prompts.

## Phase 1 — Structured logger and common context

Reuse Coreza's current logging infrastructure and add a lightweight reusable `logToolExecution` helper (name illustrative). Every event should contain:

- `timestamp`, `event` / `phase`, `level`.
- `runId`, `agentInvocationId`, `toolInvocationId`, `workflowNodeId`, `toolName`, `executorCategory`.
- `operation` (if applicable), `durationMs`, `success` / `status`, structured safe `fields`, `request` or `result` summary.

Keep the field-object construction behind a log-level check. Use one correlation ID for a tool invocation across AI input, broker request, response, indicator execution and completion.

Suggested levels:
- **info:** tool started/completed, operation, status, duration, request count and resulting row count, without detailed arguments.
- **debug:** fully sanitized generated/configured/effective input objects and actual sanitized HTTP query/body/page parameters.

If Coreza has an equivalent log-level mechanism, use it rather than adding a competing env variable.

## Phase 2 — Capture AI Agent input stages

**File:** `coreza-backend/src/nodes/executors/AIAgentExecutor.ts`

At the existing `DynamicStructuredTool.func` entry point, capture:

1. **Tool identity**: visible workflow node ID/name, generated LangChain tool name, category, invocation ID.
2. **LLM generated input**: after the existing nested `{input:{...}}` unwrapping; optionally log the raw wrapper only if necessary and safe.
3. **Configured input**: saved nonblank node fields that override generated input. Record field names and safely serialized values, with provenance `source: "configured"`.
4. **Effective input**: exact `unwrappedInput` that reaches `executor.execute()` after saved-value expression resolution and DataRef handling.
5. **Resolution metadata**: changed keys or counts so users can identify which values were overridden by fixed settings / expressions / resolved references without logging large data arrays.

Be precise about precedence: do not incorrectly merge configuration defaults into the LLM's parameters or log a computed value as if it came from the LLM.

For dataRef values, log the safe reference identifier and row count / type, not the resolved historical candle array.

## Phase 3 — Capture effective broker request fields

**File:** `coreza-backend/src/nodes/executors/BrokerExecutor.ts`

Log after operation and parameter resolution, and again immediately after building the actual outbound request. Capture all safe fields in:

- `broker`, `operation`, node ID, target API host/path and HTTP method.
- Effective `resolvedParams` including broker type, asset type, symbol(s), start date, end date, timeframe, limit, auto-pagination and max-pages **when present**.
- Actual `op.makeParams(resolvedParams, workingCreds)` query values, excluding credentials.
- Actual `op.makeBody(resolvedParams, workingCreds)` payload fields for relevant operations, with strict secret and personal-data redaction.
- Computed defaults such as `auto_paginate` and `max_pages` in a separate `effectiveOptions` section; never claim an absent field was explicitly supplied.
- HTTP request timeout if useful for diagnosis.

Custom operations using `op.execute()` must log their effective input. If the final HTTP request is created internally, add a small optional tracing hook at that boundary; do **not** fabricate `request.query` when it cannot be observed.

Never log raw authorization headers, credential material, signed URLs, secrets or full order payloads.

## Phase 4 — Pagination and normalized data diagnostics

Instrument the existing pagination path with `toolInvocationId` and page index; at debug level include safe actual per-page query parameters and the presence of a next-page token (not its secret contents if sensitive).

Record separate counts with precise meanings:
- `rawRowCount`: bars in the broker's raw response **only when determinable**; if not, `null` / unknown.
- `transformedRowCount`: bars after the broker's `transformResult` or custom operation processing.
- `normalizedRowCount`: canonical candles after `extractHistoricalCandles` and `normalizeCandles`.
- `storedRowCount`: canonical candles stored in DataContext.
- `inputRowCount`: candles actually resolved by the next indicator.
- `firstTimestamp`, `lastTimestamp`, `symbol`, `timeframe`, `dataRef` if available.

For a symbol-keyed response, count only the intended symbol's bars or label any aggregate separately. Never say `rawRowCount: 1` when that is actually one wrapper object.

Do not change normalizer logic, provider defaults, or pagination behavior to make counts match.

## Phase 5 — Generic tool results and indicator observability

At `executor.execute()` completion, log:
- success/failure, duration, category, short error type/code (sanitized);
- result type and safe size / count metadata;
- when a market-data tool returns `dataRef`, log the reference and row count;
- when an indicator runs, log sanitized period/source/indicator parameters, candle count, `observedBars`, `requiredBars`, readiness and numeric output only when valid.

Do not dump the full tool result, historical arrays or AI model response as a default log.

The generated LLM-facing result should remain unchanged by logging.

## Phase 6 — Security, configuration and performance

Create one reusable recursive redactor for **all** log points. Treat secrets and credentials as denylisted and redact nested sensitive fields; safeguard key names including `authorization`, `api_key`, `secret`, `password`, `token`, `refresh_token`, `cookie`, `client_secret`, `credential_id`, signed query tokens and credential-bearing URLs.

- Limit nesting depth, per-string length, object keys, and array elements; summarize large arrays as `[Array: N items]` and objects by safe keys/count.
- Separate credential/security metadata from parameter details and never stringify raw `workingCreds`, `headers` or transport error objects.
- For logs of free-form bodies and headers, use explicit allowlists rather than relying only on secret-name filtering.
- Redact personally identifiable data and any fields considered sensitive for account/trading operations.
- For order/trading operations, consider limiting detailed parameters to explicitly safe fields; avoid exposing account numbers or customer payloads.
- Ensure log serialization failures never interrupt a tool call.
- Keep log emission synchronous only for cheap metadata; never perform extra API/database operations for logging.
- Only compute detailed/sanitized objects when debug logging is actually active.
- Trace normal/manual AI Agent executions; allow optional detailed tracing in other modes without adding per-tick overhead to live/backtest.
- Avoid publishing sensitive request content to a WebSocket UI by default.

## Example desired logs (illustrative, not actual execution data)

```text
[AIAgent][ToolStart] runId=... invocationId=... tool=alpaca_2 node=Alpaca_Hist_Bars category=Broker
[AIAgent][GeneratedInput] { symbol:"XAR", timeframe:"1Day", start:"2026-09-01", end:"2026-10-19" }
[AIAgent][ConfiguredInput] { operation:"get_candle", asset_type:"stock" }
[AIAgent][EffectiveInput] { operation:"get_candle", symbol:"XAR", timeframe:"1Day", start:"2026-09-01", end:"2026-10-19", asset_type:"stock" }
[Broker][Request] { broker:"alpaca", operation:"get_candle", method:"GET", host:"data.alpaca.markets", path:"/v2/stocks/bars", query:{ symbols:"XAR", timeframe:"1Day", start:"2026-09-01", end:"2026-10-19" }, effectiveOptions:{ auto_paginate:true, max_pages:100 } }
[Broker][Page] { page:1, rawRowCount:35, hasNextPage:false }
[Broker][Response] { status:200, rawRowCount:35, transformedRowCount:35, durationMs:834 }
[MarketData][Normalized] { normalizedRowCount:35, storedRowCount:35, symbol:"XAR", timeframe:"1Day", dataRef:"bars:..." }
[AIAgent][ToolComplete] { tool:"alpaca_2", status:"success", durationMs:917 }
```

## Expected files to touch

| File | Planned change |
|---|---|
| `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` | Capture generated, configured and effective tool inputs; completion metadata |
| `coreza-backend/src/nodes/executors/BrokerExecutor.ts` | Capture resolved params, effective request query/body/options, response and page metadata |
| Existing shared logger or a small new logging helper | Structured events, correlation, safe serialization/redaction |
| Existing broker pagination transport | Optional safe per-page request and response summaries |
| Existing indicator execution trace | Reuse trace for count, readiness and safe result metadata |

Minimize changes and do not modify broker requests, indicators, expressions or trading logic merely to add observability.

## Acceptance criteria

1. For **every AI tool invocation**, logs reveal identity, generated input, saved overrides and final effective parameters (all safely loggable fields).
2. For broker calls, logs reveal exact safe final HTTP query/body fields and effective defaults; distinguish internal custom operations with unobservable HTTP details.
3. For `Alpaca_Hist_Bars` specifically, symbol, asset type, operation, timeframe, start/end, limit and pagination behavior are visible **if supplied or defaulted**.
4. Counts show where a one-candle result originated: request, raw/transformed response, normalization, storage or indicator resolution, to the extent each count is observable.
5. Logs for indicator tools show input row count, required bars, readiness and safe result metadata.
6. No credential leaks, oversized candle dumps, run-crossing correlation, model input changes or performance regression in live/backtest.
7. This work remains **planning only on dev**. No implementation, runtime behavior, or main-branch change is part of creating this document.
