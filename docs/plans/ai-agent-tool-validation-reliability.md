# AI Agent Tool Input Validation & Market-Data Reliability Plan

Status: **Planning only — not implemented**
Target branch: `dev`
Scope: AI-agent-generated tools, with an Alpaca market-data pilot followed by broker/indicator expansion.
Principle: minimal, backward-compatible changes; **do not introduce Python/Pydantic or MCP just to validate inputs**. Keep the existing TypeScript/Zod, LangChain and node-executor architecture.

## 1. Problem and goal

A connected node is exposed as a LangChain `DynamicStructuredTool` by `AIAgentExecutor`. The agent can issue syntactically acceptable parameters that are semantically wrong for a broker operation (invalid date ordering, malformed limit, missing time bounds, incompatible asset/feed settings). The broker may return an error or zero candles, which prevents further analysis.

Goals:
- Validate the *effective* request sent to each executor, not only the raw LLM arguments.
- Enforce operation-specific constraints without replicating whole executors or changing existing configured-node semantics.
- Preserve user intent: never silently change the requested symbol, feed, interval, period, account or trading environment.
- Make errors actionable for the LLM, distinguish legitimate zero data from invalid requests, and make debugging traces precise.
- Apply common validation to every converted node; add deeper rules only where needed.

Out of scope: replacing broker clients, changing trading strategies, automatic live trading retries, rebuilding the UI, altering backtesting/streaming engines, migrating to MCP, or adopting Python.

## 2. Verified current implementation (dev branch)

- `coreza-backend/src/nodes/executors/AIAgentExecutor.ts`:
  - `createToolsFromEdges` finds attached nodes and creates `DynamicStructuredTool` instances.
  - `getToolSchema` uses a node's fields (or `loadNodeDefinition`) and `generateSchemaFromNode` before falling back to definition schema or optional `input: any`.
  - `fieldToZodType` supports numeric coercion + UI min/max, select enum, boolean, required strings and defaults.
  - Configured fields are omitted from the exposed schema. During execution, generated input is merged with configured node values, expressions and data refs; the resulting `unwrappedInput` is passed to the actual node executor without a **common second Zod parse**.
  - Tool traces already include generated, validated, configured, and effective inputs, as well as executor results.
- `src/nodes/Alpaca.json`: `get_candle` exposes `interval` select and optional string `start`, `end`, `limit`; feed select currently defaults to `sip`. UI display conditions vary with operation and asset type.
- `coreza-backend/src/brokers/alpaca/http/operations.ts`: `get_candle` maps `interval` to `timeframe`, passes `start` and `feed`, caps `limit` via `Math.min(Number(input.limit) || 10000, 10000)`, and has pagination support. Invalid `limit: "abc"` can silently become 10000.
- `coreza-backend/src/nodes/logic/toolOutputProcessor.ts`: normalized zero historical candles are already returned as `{success:false,status:'no_data',rowCount:0}`; dataRef validation already checks certain symbol/timeframe mismatches.
- `coreza-backend/src/nodes/logic/toolDefinitions.ts` and `coreza-backend/src/brokers/capabilities.ts`: static and broker-generated tool metadata exist, but most broker metadata is descriptions rather than full per-operation Zod contracts.

These are architectural findings, not proof that every executor lacks its own internal checks. Preserve existing deeper validations where present.

## 3. Target pipeline

```text
LLM tool call
  -> existing LangChain / generated-field Zod parse
  -> merge configured values + resolve expressions + DataRefs
  -> shared effective-input validator
       -> common shape/type validation where safe
       -> optional broker/node + operation-specific rules
  -> existing executor
  -> classify and report outcome (success / no_data / invalid_input / forbidden / upstream_error)
  -> optional safe, explicit read-only recovery (later phase)
  -> structured tool result + existing diagnostics
```

**Critical:** a fixed field is authoritative. Revalidating it must not expose it as editable by the agent. Never invoke a broker or place an order when validation fails.

## 4. Implementation phases

### Phase A — Shared post-merge validation hook (smallest foundational change)

1. Add a small backend helper, e.g. `coreza-backend/src/nodes/logic/effectiveToolInputValidation.ts`, exporting:
   - `validateEffectiveToolInput({node, category, operation, input, brokerId?})`
   - a typed `ToolInputValidationError` containing safe issue paths, error codes and user-facing messages (no credentials).
   - an operation-validator registry, defaulting to **no extra semantic changes** for untouched nodes.
2. Call it in `AIAgentExecutor.createToolFromNode` **after** `resolvedConfigured` and `resolveDataRef`, **before** `executor.execute`.
3. Respect existing configured-field precedence, aliases, defaults, dynamic `displayOptions` and node executor behavior.
4. Reuse the node's field schema only where it is valid for the effective operation. Avoid reapplying optional defaults in ways that overwrite fixed/derived values. Ensure a missing definition does not become a false validation failure; retain current permissive fallback with a trace warning.
5. Do not silently strip extra keys if downstream executors legitimately consume them; distinguish known and unknown arguments and retain compatibility. Restrict strict rejection to known high-risk operations with reviewed contracts.
6. Convert validation failures into concise, structured recoverable tool errors so the agent can correct its parameters within its existing iteration budget. Keep existing `tool_validation_failed` and `tool_completed` event flow; add a phase/source marker (`effective` vs `schema`) without logging secrets.

**Acceptance:** a bad post-merge value cannot bypass the operation validator; normal tools with fixed or blank fields still execute as before.

### Phase B — Alpaca read-only operation contracts (first implementation)

Add a small reviewed validator for the actual node/executor parameter names (`operation=get_candle|get_latest_bar`, `interval` rather than `timeframe`, `assetType`/`asset_type` aliases) near Alpaca broker code or as registered validators. Reuse existing broker helper logic rather than duplicating API rules.

`get_candle` checks:
- `operation` is recognized; symbol or supported symbol list is supplied and normalized by existing broker conventions. Crypto pair validation should reuse existing `validateAlpacaCryptoSymbol` rather than a second regex.
- `interval` is one of the values actually supported by the Coreza node and Alpaca endpoint; never invent/rescale timeframes.
- `limit`, if supplied, parses as a finite positive integer in the supported range. Reject `abc`, `0`, negative, fractional, `NaN`, infinity; no implicit fallback to 10000 for an explicitly invalid value. Retain existing missing-value default for compatibility.
- `start`/`end`, if present, parse as valid timestamps in an API-supported format; reject ambiguous timestamps when necessary; if both are present, enforce `start < end`; guard against future end values only when the endpoint/operation requires it. Do **not** assume `limit=100` alone guarantees 100 trading bars.
- `feed` must be compatible with asset type and operation; don't send stock-only feeds to crypto. Preserve an explicit feed selection. An entitlement failure must be classified as `permission/entitlement`, not auto-switched to another feed.
- `sort`, `adjustment`, `currency`, `page_token` are checked only when relevant to the specific endpoint; preserve the broker's existing normalization and pagination.
- If the user asks for `last N bars`, distinguish that intent from an explicit `start`/`end` range. Resolve a suitable historical window via a separate explicit helper/operation enhancement, not a blanket injection of dates in the schema; use exchange calendars for equity sessions and 24/7 rules for crypto. Return `requestedBarCount` versus `returnedBarCount`.

`get_latest_bar` checks:
- symbol/asset normalization and operation-specific feed compatibility; no `interval` required.
- Do not treat a missing latest bar during closed sessions as bad parameters by default.

**Acceptance:** inverted dates and malformed limits fail *before the HTTP call*; valid fixed and model-supplied requests preserve behavior; unsupported feed/asset combinations get informative errors.

### Phase C — Structured result and no-data diagnostics

1. Keep the existing `toolOutputProcessor` dataRef/candle pipeline. Do **not** duplicate canonical normalization or copy full OHLCV arrays into the LLM result.
2. Enrich a `no_data` outcome with safe metadata: requested symbol, interval, feed, effective start/end, asset type, returned rows, request count and known provider code. Mark possible causes as *hypotheses*, not confirmed facts.
3. Distinguish:
   - `invalid_input` (local contract failed);
   - `permission_denied` / `feed_not_entitled` (provider response);
   - `no_data` (valid request, zero observations);
   - `upstream_error` / timeout / rate limit;
   - `success` (positive rows; optionally partial requested coverage).
4. Record `requested/validated/configured/effective` parameter snapshots through current tool traces with sensitive field redaction, plus attempt number, decision reason, provider status, returned row count, first/last timestamps, duration. Avoid high-cardinality full-data logging.
5. Agent messaging should say `no_data` when no data was returned and must never claim analysis on missing candles.

**Acceptance:** logs explain *why* a request was invalid or empty; indicator tools never receive a fabricated successful dataRef.

### Phase D — Bounded recovery for read-only historical fetches

Only after Phases A–C, optionally implement a small **read-only** recovery policy in the broker data fetch path:
- One or at most two bounded retry attempts, with explicit audit trail.
- Retry transient upstream failures with backoff; use pagination where supported.
- For ambiguous `last N bars` requests, a market-calendar-aware prior-session range may be used **only if it preserves user intent**, and the attempted range must be disclosed.
- Never silently switch IEX/SIP/overnight feeds, account, symbol, interval, asset class or explicitly requested timestamps; never escalate entitlement.
- For explicitly requested dates or feeds, return `no_data` with actionable diagnostic suggestions instead of substituting a different dataset.
- No automatic retry for trading mutations (`place_order`, `cancel_order`, `close_position`) because duplicates/side effects are dangerous.
- Respect agent cancellation, rate limits and execution time budgets.

**Acceptance:** read-only recoveries are bounded, attributable and cannot change the meaning of the requested data.

### Phase E — Extend operation registry to other converted nodes

Inventory every tool-capable node from node definitions + broker capabilities, and classify by risk:
1. **High priority market-data brokers:** Alpaca, Schwab, Binance, Dhan (their asset-specific required fields, time units, subscriptions, feed entitlement and date rules differ).
2. **Indicator tools:** RSI, EMA, SMA, MACD, ATR, Stochastic, etc. Check positive/consistent periods, minimum candle count, DataRef resolution, symbol/timeframe provenance, finite numeric values. Reuse existing indicator readiness and dataRef checks; do not duplicate indicator math.
3. **Other read-only utilities:** screeners, news, search, date, transform, HTTP. Validate only meaningful cross-field constraints; beware user-configured HTTP endpoints.
4. **Side-effect tools:** all trade/cancel/sync and workflow mutation tools. Require strict operation-specific schema, credential scope, paper/live identity, authorization and separate execution-safety rules. **No generic auto-correct or retry**.

For each node, record `field schema`, `operation-specific schema`, `executor checks`, `response validation`, `recovery policy`; gaps become small follow-on changes rather than an invasive common rewrite.

## 5. Design safeguards

- **Single source of truth:** Prefer broker-operation validators near existing broker operations, reused by the agent path. Do not recreate dozens of fields in both node JSON and Zod if metadata can be safely reused.
- **No surprise defaults:** Never silently choose SIP, IEX, a different historical window, or a larger candle count based on an invalid input. Any existing node defaults must be distinguished from AI choices in traces.
- **Correct time semantics:** Timestamp timezone, market session, exchange calendar, current session vs last completed session, stock vs crypto, and feed rules must be explicit.
- **Maintain tool compatibility:** Shared hooks must not break dynamically configured node fields, optional `dataRef`, nested `input` wrappers, aliases, or existing tool names.
- **Validation is not market availability:** A well-formed request can legitimately return zero bars.
- **Credentials/data:** Never expose API keys, account identifiers or large raw responses in logs or model-visible errors.
- **Mutating operations:** Reject before execution; prohibit automatic replays without validated idempotency and user authorization.
- **Performance:** Only local schema checks in the synchronous tool path; no extra remote lookup for every invocation.

## 6. Concrete examples / desired behavior

| Request | Today | Desired |
| --- | --- | --- |
| `get_candle({symbol:'RKLB',interval:'1Day',start:'2026-11-10',end:'2026-08-01'})` | UI-field types can pass; broker likely errors | Local `invalid_input` with `start < end` correction |
| `get_candle({symbol:'RKLB',interval:'1Day',limit:'abc'})` | Numeric fallback can yield 10000 | Local `invalid_input` for `limit` |
| `get_candle({symbol:'RKLB',interval:'5Min',feed:'iex',limit:'100'})` returns no bars | `no_data` detected | `no_data` + effective parameters + clear potential reasons; no silent feed switch |
| Agent's `1Day` RSI references `5Min` data | Existing DataRef provenance check | Preserve check; emit actionable mismatch |
| Fixed node `feed='sip'`, LLM proposes `iex` | Fixed config wins | Fixed config wins; validated post-merge and trace records override |
| `place_order` returns timeout | Executor behavior varies | Never blind retry; preserve current trade safety and reconciliation |

Example **tool-facing** invalid input (no remote request):
```json
{
  "status": "invalid_input",
  "tool": "alpaca",
  "operation": "get_candle",
  "issues": [{"field":"limit","code":"invalid_positive_integer","message":"limit must be a positive integer (1..10000)"}],
  "retryable_by_agent": true,
  "provider_request_sent": false
}
```

Example valid empty result:
```json
{
  "status": "no_data",
  "operation": "get_candle",
  "symbol": "RKLB",
  "interval": "5Min",
  "feed": "iex",
  "returnedBarCount": 0,
  "provider_request_sent": true,
  "retryable_by_agent": false,
  "suggestion": "Verify the requested session and feed entitlement; no substitute dataset was used."
}
```

## 7. Files expected to change

**Primary**
- `coreza-backend/src/nodes/executors/AIAgentExecutor.ts` — invoke post-merge validation and translate failures.
- New `coreza-backend/src/nodes/logic/effectiveToolInputValidation.ts` — small shared registry/error helper.
- `coreza-backend/src/brokers/alpaca/http/operations.ts` and/or new adjacent Alpaca validator — enforce `get_candle` / `get_latest_bar` contract with one source of truth.
- `coreza-backend/src/nodes/logic/toolOutputProcessor.ts` — enrich existing `no_data` metadata without changing DataRef semantics.
- `coreza-backend/src/utils/toolExecutionLog.ts` — only if additional safe diagnostic fields are required.

**Optional/later**
- `src/nodes/Alpaca.json` — clarify validation metadata and descriptions only if needed.
- Broker-specific validators and related node JSON for Schwab/Binance/Dhan.
- Indicator input validators where existing readiness and dataRef checking is insufficient.

Avoid touching frontend/editor or workflow execution broadly unless a concrete incompatibility is discovered.

## 8. Verification checklist before implementation is considered done

- Invalid dates, malformed timestamps, inverted ranges, invalid limit, unsupported combinations -> reject before broker request.
- Agent-provided values and configured values follow intended precedence; post-merge validators catch bad fixed-expression values.
- All legitimate tools with missing/optional metadata still run; no accidental schema stripping.
- Stock vs crypto, explicit feed, closed market, empty session, pagination and entitlement error paths have correct classification.
- Existing canonical candle normalization, DataRef and indicator tool chaining remain unchanged.
- No tool reports success or indicator confirmation from zero valid candles.
- Trade/cancel/close tools never auto-retry and never execute on validation failure.
- Trace diagnostics are useful without leaking credentials or huge market payloads.
- Confirm that the added hook doesn't materially increase per-tool execution latency.

## 9. Implementation order / deliverables

1. **PR 1:** Shared validation hook + structured local validation errors, no broker behavior changes.
2. **PR 2:** Alpaca market-data operation contracts and robust limits/date validation.
3. **PR 3:** No-data diagnostics and safe logging.
4. **PR 4 (optional):** Read-only historical-data recovery with explicit guardrails.
5. **Follow-on PRs:** Schwab, Binance, Dhan and indicator-specific validators, prioritized from actual failed tool traces.

The first PRs should stay minimal and separately reviewable. This document is a plan only; no runtime code, tests, or migrations are changed by committing it.
