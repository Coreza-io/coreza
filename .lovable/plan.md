# Audit: N8N / QuantConnect / hardcoded credentials

## Summary

Full-codebase scan (excluding `node_modules`, `package-lock.json`, `.git`). All hits are in **docs, comments, or test fixtures** — no production code, no real secrets.

## 1. N8N references — 4 hits, all in docs

Used only as a comparison point in architecture RFCs.

- `docs/COMPILED_PLAN_ADAPTERS_RFC.md:38, 40` — "Coreza vs n8n / QuantConnect" comparison.
- `docs/coreza-trading-os-architecture-rfc.md:67` — comparison table row.
- `docs/coreza-trading-os-rfc.md:46, 48` — comparison table row.

**Action:** none required. These are positioning docs, not product code. If you want to remove the comparison framing entirely, edit those three markdown files and drop the n8n rows / paragraphs.

## 2. QuantConnect references — 4 hits

All comparative or descriptive — no QC code, API, or credentials.

- `docs/COMPILED_PLAN_ADAPTERS_RFC.md:38, 41` — "vs QuantConnect" comparison.
- `docs/coreza-trading-os-architecture-rfc.md:68` — comparison table.
- `docs/coreza-trading-os-rfc.md:46, 48` — comparison table.
- `coreza-backend/src/backtest/simBroker/index.ts:652` — code comment: `"Called by engine before strategy code runs each bar (QuantConnect-style)."`
- `src/nodes/InitializeIndicators.json:7` — node description string: `"Similar to QuantConnect's SetWarmUp."`

**Action:** the two non-doc mentions (`simBroker` comment + `InitializeIndicators.json` description) are user-visible if you ship to public. Recommend rewording to neutral phrasing:
- `simBroker/index.ts:652` → `"Called by engine before strategy code runs each bar (bulk mark-to-market)."`
- `InitializeIndicators.json:7` → `"Warm up all indicators in the workflow with historical data before the loop begins."`

## 3. Hardcoded user credentials — none in production

Scanned for: literal `password|api_key|secret|token|bearer = "..."`, JWT-shaped strings (`eyJ...`), and UUID-shaped `user_id = "..."`.

All hits are test fixtures, intentionally fake:

- `coreza-backend/market-stream-service/tests/binanceAuthMessage.test.ts` — `'api-key'` placeholder.
- `coreza-backend/src/tests/security.test.ts` — `'PKTEST123456789'` Alpaca paper-test pattern.
- `tests/integration/trading.test.ts` — `'invalid-key'`, `'test-key'`, `'test-client-secret'`.

No JWTs, no real Supabase keys, no hardcoded `user_id` UUIDs found outside of tests. All runtime credentials flow through `CredentialManager` / `req.user?.id` / `process.env` as expected from the project's core rules.

## Recommendation

1. Leave test files as-is.
2. Optionally reword the two non-doc QuantConnect mentions (`simBroker/index.ts:652`, `InitializeIndicators.json:7`) to remove brand reference from shipped artifacts.
3. Optionally scrub the n8n/QC comparison tables in the three RFC docs if you'd rather not position against them publicly.

Let me know which of those edits to apply and I'll do them in build mode.
