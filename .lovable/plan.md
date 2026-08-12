# Rolling Window: make manual route and live executor byte-for-byte in sync

Goal: one shared key builder (already in place), one shared payload builder, one shared input parser, identical validation messages, and bounded memory in both paths.

## Current divergences (confirmed by reading both files)

| # | Divergence | Manual route (`src/routes/storage.ts`) | Live executor (`IndicatorsExecutor.executeRollingWindowNode`) |
| --- | --- | --- | --- |
| D1 | `set` payload | no `latest` field | includes `latest` |
| D2 | Unresolved `{{ }}` in `candle_data` | explicit 400 "Candle data contains unresolved template references..." | silently parses to `[]`, reports "No bars provided in candle_data" |
| D3 | `window` value | copied array `[...window.values()]` | live `window.values()` reference on a mutated per-node cached object |
| D4 | Buffer lifetime | module-level `Map`, never evicted (leaks per `workflowSessionId`) | `DataContext`, discarded with the run; key cache cleared on `runId` change |
| D5 | `set` meta | `{ key, barsAdded, timestamp }` | no `meta` at all |

Already in sync and to be left alone: key construction via `buildExecutionScopedKey({ scope: "rolling_window", parts: [symbol, timeframe] })` -> `RedisKeys.rollingWindow`, symbol upper-case/trim, timeframe trim, `"_"` fallbacks on `set`, size clamp `1..500`, size-change reallocation, `get` validation order (symbol then timeframe), and `found: false` returning success.

## Step 1 — Shared module: `coreza-backend/src/engine/rollingWindowShared.ts` (new)

Pure, dependency-free (imports only `RollingWindow`), so both the Express route and the executor can use it.

```ts
export interface RollingWindowPayload {
  window: unknown[];
  count: number;
  size: number;
  isReady: boolean;
  remaining: number;
  latest: unknown | null;
  found: boolean;
}

export const ROLLING_WINDOW_ERRORS = {
  symbolRequired: "symbol is required for get operation",
  timeframeRequired: "timeframe is required for get operation",
  unresolvedTemplate:
    "Candle data contains unresolved template references. Execute the upstream node first.",
  invalidCandleData: "Invalid candle_data format",
  noBars: "No bars provided in candle_data",
} as const;

export function normalizeSymbol(v: unknown): string;   // String(v ?? "").trim().toUpperCase()
export function normalizeTimeframe(v: unknown): string; // String(v ?? "").trim()
export function clampWindowSize(v: unknown): number;    // min(max(parseInt||20,1),500)

export function buildRollingWindowPayload(
  window: RollingWindow<unknown> | undefined,
): RollingWindowPayload;
// present -> { window: [...values()], count, size, isReady, remaining: size-count,
//              latest: count > 0 ? at(0) : null, found: true }
// absent  -> { window: [], count: 0, size: 0, isReady: false, remaining: 0,
//              latest: null, found: false }

export type ParsedBars =
  | { ok: true; bars: unknown[] }
  | { ok: false; error: string };

export function parseCandleData(raw: unknown): ParsedBars;
// array -> ok; non-array object -> [obj]; string containing "{{" -> unresolvedTemplate;
// string -> JSON.parse, non-JSON -> invalidCandleData; anything else -> [];
// empty result -> { ok:false, error: noBars }
```

Fixes D1, D2, D3 (the payload always copies), and guarantees identical error strings.

## Step 2 — `coreza-backend/src/routes/storage.ts`

- Import the shared helpers; delete the local normalization, size clamp, and inline `candle_data` branching.
- `get`: unchanged control flow, but the response `data` becomes `buildRollingWindowPayload(rollingWindows.get(storeKey))`.
- `set`: `const parsed = parseCandleData(candle_data); if (!parsed.ok) return res.status(400).json({ success:false, error: parsed.error });` then add bars and respond with `data: buildRollingWindowPayload(window)` and `meta: { key: storeKey, barsAdded: parsed.bars.length, timestamp: new Date().toISOString() }` (D5 stays route-only; `meta` is additive and harmless).
- **Eviction (D4).** Replace the bare `Map` with a bounded, session-indexed store in the same file:

```ts
const MAX_SESSIONS = 200;
const rollingWindows = new Map<string, RollingWindow<unknown>>();      // storeKey -> window
const sessionKeys = new Map<string, Set<string>>();                    // sessionId -> storeKeys (insertion-ordered = LRU)

function touchSession(sessionId: string, storeKey: string) {
  let keys = sessionKeys.get(sessionId);
  if (keys) sessionKeys.delete(sessionId);            // re-insert to move to MRU end
  else keys = new Set<string>();
  keys.add(storeKey);
  sessionKeys.set(sessionId, keys);
  while (sessionKeys.size > MAX_SESSIONS) {
    const [oldest, oldestKeys] = sessionKeys.entries().next().value;
    for (const k of oldestKeys) rollingWindows.delete(k);
    sessionKeys.delete(oldest);
  }
}
```

  `touchSession(workflowSessionId, storeKey)` is called on every `set` (after the window is created) and on every `get` (to keep an actively read session from being evicted). A new `workflowSessionId` from a manual session reset naturally starts empty, matching the live path's per-run `DataContext`.

## Step 3 — `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts`

- Import the shared helpers; replace the inline `.trim().toUpperCase()`, size clamp, and the `rawCandle` if/else chain.
- `get`: `data: buildRollingWindowPayload(window)`, `meta: { key: storeKey, timeframe: requestedTimeframe }` unchanged.
- `set`: `const parsed = parseCandleData(params.candle_data); if (!parsed.ok) return toNodeResult(createErrorOutput(parsed.error, { nodeId: node.id, nodeName: "RollingWindow", category: this.category }));` — this is what surfaces the unresolved-template message live (D2).
- Keep the `rollingWindowResults` per-node cached object for allocation reuse, but fill it from the shared payload so `window` is a snapshot copy (D3):

```ts
const payload = buildRollingWindowPayload(window);
const rw = this.rollingWindowResults.get(node.id) ?? { success: true, data: {} as any };
Object.assign(rw.data, payload);
this.rollingWindowResults.set(node.id, rw);
return rw;
```

- Leave `rollingWindowKeyCache` (keyed `symbol:timeframe`) and its clearing on `runId` change untouched.

## Step 4 — Behavioural contract after the change

For the same `{ operation, symbol, timeframe, size, candle_data }`, manual and live return:
- identical `data` keys and values (`window, count, size, isReady, remaining, latest, found`),
- identical error text for missing symbol, missing timeframe, unresolved template, unparseable candle data, and zero bars,
- differing only in transport shape: route = HTTP 400 + `{ success:false, error }` and an extra `meta.barsAdded`/`meta.timestamp`; executor = normalized `createErrorOutput` node result.

## Step 5 — Tests

- `coreza-backend/tests/rollingWindowOperations.test.ts`
  - `set` now returns `latest`.
  - String `candle_data` containing `{{ ... }}` returns the unresolved-template error (not "No bars").
  - Mutating a returned `window` array, or a later `set`, does not alter a previously returned payload.
- New `coreza-backend/tests/rollingWindowSharedParity.test.ts`
  - Drives `parseCandleData` / `buildRollingWindowPayload` directly across array, single object, JSON string, template string, garbage string, and empty input.
  - Asserts `Object.keys(payload)` for the found and not-found cases match between a route-style call and an executor-style call.
- New route test for eviction: writing `MAX_SESSIONS + 1` sessions drops the oldest session's keys while the newest still reads `found: true`.
