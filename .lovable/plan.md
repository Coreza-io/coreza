# Rolling Window: `set` / `get` operations

Add an `operation` selector to the Rolling Window node:

- **Set (default)** — exactly today's behaviour: push bar(s) into the bounded FIFO buffer for `symbol` + `timeframe` and return the window state.
- **Get** — read-only. Only a `symbol` field is shown; it returns the current rolling-window data for that symbol without mutating anything.

## UI — `src/nodes/RollingWindow.json`

Add a first field:

```
{ key: "operation", type: "select", label: "Operation", default: "set",
  options: [ {label:"Set", value:"set"}, {label:"Get", value:"get"} ] }
```

Field visibility via `displayOptions.show.operation`:

| Field | set | get |
|---|---|---|
| `size` | shown (required) | hidden |
| `candle_data` | shown (required) | hidden |
| `symbol` | shown | shown (**required**) |
| `timeframe` | shown | hidden |

Description of `symbol` under `get`: "Returns the rolling-window data buffered for this symbol."

## Backend — the two execution paths

Rolling Window runs through two code paths and both need the operation branch:

1. `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts` → `executeRollingWindowNode` (workflow/live/backtest path, buffers live in `DataContext` keyed by `buildExecutionScopedKey`).
2. `coreza-backend/src/routes/storage.ts` → `POST /storage/rolling-window` (manual single-node test, buffers live in the module-level `rollingWindows` Map).

### Symbol-only lookup

Buffers are keyed by `nodeId + symbol + timeframe`, so a `get` that supplies only a symbol needs an index. Add a per-node symbol index alongside the existing key cache:

- `IndicatorsExecutor`: reuse `rollingWindowKeyCache` — it is already keyed `nodeId:symbol:timeframe`. On every `set`, also record `symbolIndex.set(`${nodeId}:${symbol}`, storeKey)`. `get` reads that map, then `dataContext.getDataByKey(storeKey)`.
- `storage.ts`: add `const rollingWindowIndex = new Map<string, string>()` mapping `${userId}:${workflowSessionId}:${node_id}:${symbol}` -> storeKey, written on `set`, read on `get`.

Both indexes are cleared wherever `rollingWindowKeyCache` / execution state is already cleared (executor reset on new execution), so `get` never leaks across executions.

If a symbol is buffered under several timeframes for the same node, the index holds the most recently written timeframe; the response `meta` includes the resolved `timeframe` and `key` so the user can see which buffer was read.

### `set` behaviour
Unchanged. Additionally writes the symbol index entry.

### `get` behaviour
- Validate `symbol` is present -> otherwise error `symbol is required for get operation`.
- Resolve the store key from the index; if absent, or the buffer does not exist yet, return a **successful** empty-state payload rather than an error:

```json
{ "window": [], "count": 0, "size": 0, "isReady": false, "remaining": 0, "latest": null, "found": false }
```

- When found, return the identical shape as `set` (`window`, `count`, `size`, `isReady`, `remaining`, `latest`) plus `"found": true`, without calling `window.add(...)`.
- `get` never creates a buffer and never errors on missing `candle_data`.

In `IndicatorsExecutor`, the `get` branch must return a fresh result object (not the shared mutable `rollingWindowResults` entry used by `set`) so a read cannot overwrite the set-node's cached output.

## Route plumbing

`POST /storage/rolling-window` currently hard-requires `candle_data` and errors on empty bars. Branch on `req.body.operation ?? "set"` before those validations so `get` skips the size/candle validation entirely and only requires `symbol` + `workflowSessionId`.

## Output shape

Unchanged for `set`. `get` returns the same fields plus `found`, so downstream nodes and templates (`{{ $('Rolling Window').json.data.window }}`) work identically for both operations.
