# Fix: Rolling Window `get` cannot find the window written by `set`

## Review of what was implemented

Implemented and correct:
- `operation` select in `src/nodes/RollingWindow.json` with `displayOptions` gating.
- `get` branch in `IndicatorsExecutor.executeRollingWindowNode` returning a fresh, non-mutating result with `found` plus `meta.key` / `meta.timeframe`.
- `get` branch in `POST /storage/rolling-window` that skips size/candle validation, requires `symbol`, and returns the same shape.
- Index writes happen only after a successful `set` (after bars are added), and the executor clears its indexes on run change.

## The defect the screenshot shows

Both index maps are **node-scoped**, so only the *same node* can read back its own window:

- `coreza-backend/src/routes/storage.ts:59` — `indexKey = ${userId}:${workflowSessionId}:${node_id}:${symbol}`
- `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts:377,493` — `${node.id}:${symbol}`

The stored entry is written by the **Set** node (`...:RollingWindow:AMD`) while the read comes from a **different Get node** (`...:getAMDRollingWindow:AMD`) — the lookup can never hit. The store key itself is node-scoped too (`storage.ts` uses `scope: node_id`; the executor uses `nodeId` → `RedisKeys.nodeState`), so even a symbol-only scan would not help.

Two smaller issues:
1. `RollingWindow.json` declares the `symbol` field **twice** (same `key`, one per operation). Duplicate keys in one field list are fragile for value reconciliation/serialization — collapse to one field.
2. The executor resolves the timeframe for `meta` by scanning `rollingWindowKeyCache` with `Array.from(...).find(...)` on every `get` — O(n) and easy to break. Store the timeframe alongside the key instead.

## The fix: make rolling-window buffers workflow-scoped, not node-scoped

Within one execution, `symbol + timeframe` already identifies a rolling window uniquely — the node id adds nothing but prevents cross-node reads. No new field is introduced.

### 1. Node definition — `src/nodes/RollingWindow.json`

- Collapse the two `symbol` entries into a **single** field (`required: true`, description covering both operations, shown for both operations).
- `size`, `candle_data`, `timeframe` stay gated to `operation: ["set"]` — `get` still resolves the timeframe from the index.

### 2. Key scheme (both paths, identical)

Store key — drop the node id:

```
RollingWindow:userId:<u>:workflowId:<w>:executionId:<e>:<symbol>:<timeframe>
```

Index key — lets a symbol-only `get` resolve the concrete store key:

```
<userId>:<workflowId>:<executionId>:<symbol>   ->   { storeKey, timeframe }
```

`symbol` is trimmed and upper-cased on both write and read so casing mismatches don't miss. If the same symbol is written with two timeframes, the index holds the most recently written one (existing documented behaviour, unchanged).

Use `RedisKeys.rollingWindow(...)` for the store key, dropping its `nodeId` argument (it is referenced only by the rolling-window paths), and route both call sites through `buildExecutionScopedKey` so the two paths cannot drift.

### 3. `IndicatorsExecutor.executeRollingWindowNode`

- Replace `rollingWindowSymbolIndex: Map<string,string>` with `Map<string, { storeKey: string; timeframe: string }>` keyed by the index key above (no `node.id`).
- `set`: build the store key without `nodeId`; write the index entry after bars are added (unchanged ordering).
- `get`: read the index entry directly; drop the `Array.from(...).find(...)` scan and use the stored `timeframe` for `meta`. Missing entry still returns the successful `found: false` payload.
- `rollingWindowKeyCache` key becomes `symbol:timeframe` (node-independent); it and the symbol index still clear together on run change.
- Keep `rollingWindowResults` keyed by `node.id` — that is per-node output caching and is correct as-is.

### 4. `POST /storage/rolling-window` (manual test path)

- Build `indexKey` as `${userId}:${workflowSessionId}:${symbol}` and `storeKey` without `node_id`; `node_id` stays in the body but no longer participates in either key.
- Store `{ storeKey, timeframe }` in `rollingWindowIndex` so `get` stops deriving the timeframe with `lastIndexOf(":")`.
- Manual buffers stay scoped by `workflowSessionId`, so a session reset still isolates state.


### 5. Backward behaviour

An existing workflow with a single Set node and no Get keeps working: `windowName` defaults to `"default"`, and buffers are per-execution/session in-memory only, so there is nothing persisted to migrate.

## Tests to update — `coreza-backend/tests/rollingWindowOperations.test.ts`

- Existing cases keep passing (single node, default window name).
- Add: a **Set on node A, Get on node B** case that now returns `found: true` — this is the regression the screenshot describes.
- Add: two Set nodes with different `windowName` writing the same symbol; each Get resolves its own buffer.
