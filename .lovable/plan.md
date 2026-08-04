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

- Collapse the two `symbol` entries into a **single** field (`required: true`, shown for both operations).
- Show `timeframe` for **both** operations and make it `required: true`, so `get` addresses the exact same key the `set` wrote.
- `size` and `candle_data` stay gated to `operation: ["set"]`.

### 2. Key scheme (both paths, identical)

One deterministic key, no index map, no string stripping:

```
RollingWindow:userId:<u>:workflowId:<w>:executionId:<e>:<symbol>:<timeframe>
```

`symbol` and `timeframe` are trimmed; `symbol` is upper-cased on both write and read so casing mismatches can't miss. `get` builds this exact key and does a single O(1) lookup.

Use `RedisKeys.rollingWindow(...)` for the store key, dropping its `nodeId` argument (it is referenced only by the rolling-window paths), and route both call sites through `buildExecutionScopedKey` so the two paths cannot drift.

### 3. `IndicatorsExecutor.executeRollingWindowNode`

- Delete `rollingWindowSymbolIndex` entirely — no longer needed.
- `get`: require both `symbol` and `timeframe`; build the store key exactly as `set` does, read it from `dataContext`, and return `found: false` (success) when absent. `meta.timeframe` is the requested timeframe; drop the `Array.from(...).find(...)` scan.
- `set`: build the store key without `nodeId`; behaviour otherwise unchanged.
- `rollingWindowKeyCache` key becomes `symbol:timeframe` (node-independent) and still clears on run change.
- Keep `rollingWindowResults` keyed by `node.id` — that is per-node output caching and is correct as-is.

### 4. `POST /storage/rolling-window` (manual test path)

- Delete the `rollingWindowIndex` map and `indexKey`.
- `get`: validate `symbol` and `timeframe`, build the same node-less `storeKey` (scoped by `workflowSessionId`), and read `rollingWindows.get(storeKey)` directly — no `lastIndexOf(":")` derivation.
- `set`: same key construction; `node_id` stays in the body but no longer participates in the key.

### 5. Backward behaviour

An existing workflow with a single Set node and no Get keeps working: buffers are per-execution/session in-memory only, so there is nothing persisted to migrate. Existing Set nodes that left `timeframe` blank keep the `"_"` fallback on the write side; a Get for such a window must leave `timeframe` matching.

## Tests to update — `coreza-backend/tests/rollingWindowOperations.test.ts` and `executionKey.rollingWindow.test.ts`

- Update key-shape assertions to the node-less store key.
- Add: **Set on node A, Get on node B** with the same symbol + timeframe now returns `found: true` — the regression the screenshot describes.
- Add: `get` with a timeframe that was never written returns `found: false` with success.
- Add: `get` missing `timeframe` returns a validation error.
