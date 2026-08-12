# Rolling Window: manual route vs live executor — sync audit and fixes

## Where they already agree

| Concern | `POST /storage/rolling-window` | `IndicatorsExecutor.executeRollingWindowNode` |
| --- | --- | --- |
| Key builder | `buildExecutionScopedKey({ scope: "rolling_window", parts:[symbol, timeframe] })` | same |
| Execution scope | `workflowSessionId` as `executionId` | `context.runId` as `executionId` |
| Symbol/timeframe normalization | trim + upper-case symbol, trim timeframe | same |
| `set` fallbacks | blank symbol/timeframe -> `"_"` | same |
| Size clamp | `min(max(parseInt(size)||20,1),500)` | same |
| Size change | new `RollingWindow` (old bars dropped) | same |
| `get` validation | requires symbol and timeframe | same |
| `get` miss | `success: true` with `found: false` payload | same |
| Node scoping | none — any node can read | none |

Keys round-trip identically, so a Set node and a separate Get node resolve the same buffer in both modes. That part is in sync.

## Where they are out of sync

1. **`set` response shape differs.** The route's `set` returns `window, count, size, isReady, remaining` — no `latest`. The executor's `set` also returns `latest`. A downstream `{{ $('RollingWindow').json.latest }}` resolves live but is `undefined` when the user tests the node manually.
2. **Unresolved-template guard is route-only.** The route rejects `candle_data` containing `{{` with an explicit "unresolved template references" message; the executor silently parses to `[]` and reports the generic "No bars provided in candle_data".
3. **Manual buffers are never evicted.** `rollingWindows` is a module-level `Map` with no TTL and no clear on session reset, so every `workflowSessionId` x symbol x timeframe combination leaks for the process lifetime. The live path stores windows in the execution's `DataContext`, which is discarded with the run, and the executor clears `rollingWindowKeyCache` when `runId` changes.
4. **`window` value aliasing.** The route returns a copied array (`[...window.values()]`); the executor assigns the live `window.values()` reference onto a per-node cached result object that is mutated on every subsequent `set`. Two consumers holding the "previous" output see it change under them.
5. **Error envelope.** The route returns HTTP 400 with `{ success:false, error }`; the executor returns a normalized `createErrorOutput` node result. Same message text, different surface — acceptable, but the messages should be kept literally identical so tests can assert both.

## Fixes

### 1. `coreza-backend/src/routes/storage.ts`
- Add `latest: window.count > 0 ? window.at(0) : null` to the `set` response so both modes return the same five-plus-one fields.
- Evict manual buffers: keep a `Map<sessionId, Set<storeKey>>` alongside `rollingWindows` and delete a session's keys when a new `set` arrives for a session whose store is stale, plus a simple size cap (e.g. drop the oldest session once the map exceeds ~500 sessions). Minimal, no Redis dependency.

### 2. `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts`
- Detect an unresolved template in a string `candle_data` (contains `{{`) and return the same message the route uses: `"Candle data contains unresolved template references. Execute the upstream node first."`
- Return `window: [...window.values()]` (a snapshot copy) in both `set` and `get` instead of the live buffer reference, keeping the per-node cached result object for allocation reuse.

### 3. Shared shape helper
Extract the response payload builder used by both paths into a small helper (e.g. `buildRollingWindowPayload(window)` in `coreza-backend/src/engine/RollingWindow.ts`) returning `{ window, count, size, isReady, remaining, latest, found }`, and use it in the route and the executor for `set`, `get`, and the not-found case. This is what stops the two shapes drifting again.

## Tests
- `coreza-backend/tests/rollingWindowOperations.test.ts`: assert `set` returns `latest`; assert an unresolved-template `candle_data` returns the template error.
- Add a route-level test asserting the `set` and `get` payload keys match the executor's exactly.
