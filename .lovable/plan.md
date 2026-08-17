# Fix Store node erroring in live — opt-in async, sync fast path untouched

## Root cause (confirmed by the debugger screenshot)

`coreza-backend/src/backtest/compiled/adapters.ts` → `buildExecAdapter` calls `executor.execute(...)`; when the result is a thenable it discards it and returns `Compiled plan requires synchronous executor for category ...`. `DataSourceExecutor` (which serves the Store node) is async, so the `rpush` still lands in Redis while the node is marked failed and the engine hops back to OnBar with no visible error.

## Approach: keep the synchronous hot path, allow async only where declared

Do **not** make every node await. Instead:

1. **Per-executor opt-in.** `INodeExecutor` already carries `syncCapable`. Treat `syncCapable === false` (or absent) as "may return a promise". `DataSourceExecutor` currently declares `syncCapable = true` while returning a promise — that lie is what the adapter is catching. Set it to `false`.
2. **Two adapter shapes at compile time.** In `buildExecAdapter`, branch once on `executor.syncCapable`:
   - sync executors (Indicators, Compute, IF, Portfolio, …) keep today's exact code path — no promise checks in the hot loop, zero added overhead;
   - async-declared executors return the promise, and the compiled plan's node-step awaits only these nodes.
3. **Async nodes stay off the per-bar hot path by policy.** Only categories that genuinely do I/O (DataSource/Store, Broker HTTP, AI) may opt in; keep the "requires synchronous executor" error for any executor that declares `syncCapable = true` yet returns a thenable, so a future regression is still caught loudly instead of silently.
4. **Runner change is minimal.** The compiled runner's exec call becomes `const r = execFn(...); const res = isAsyncNode ? await r : r;` where `isAsyncNode` is a boolean precomputed per node at compile time — a property read, not a promise check.
5. **Warm-up policy unchanged.** `enforceWarmupPolicy` still short-circuits before `executor.execute`, so suppressed/rejected nodes never start async work.
6. **Surface failures.** Ensure a `success: false` from an async node reaches the node result/output panel and the live socket rather than a silent return to OnBar.

## Error message not reaching the output panel

The Store node now renders `error {...}` (an object) instead of readable text, and the actual failure is `WRONGTYPE Operation against a key holding the wrong kind of value` — the `ticker` key already exists as a LIST while the node is configured as a Set/`sadd`. Two separate defects:

- **Wrong shape.** `StorageService.execute` returns a full `StandardNodeOutput` (`{ success, status, error, details, meta }`). `DataSourceExecutor` passes that object straight through as the node's payload for the Store branch instead of unwrapping it like the other branches do (`normalizeOutput` + `toNodeResult`, or `createErrorOutput(result.error, ...)` as done for the generic data-source path). The nested object lands in `error`, so the panel prints `{...}`. Fix: in `executeStorageNode`/`executeStoreNode`, when the storage result has `success === false`, return `toNodeResult(createErrorOutput(result.error ?? ..., { nodeId, nodeName, category }))`; on success return `toNodeResult(normalizeOutput(result.data, ...))` — matching the RedisStore branch that already works.
- **Message preserved end to end.** In `storageService.ts` log `error.stack` with `serviceKey`/`operation` and build the message as `error?.message || error?.name || String(error)` so it can never be empty; in the compiled adapter keep `syncResult.error` verbatim rather than replacing it with the generic `Node execution failed: <category>`.
- **Actionable WRONGTYPE.** In `store.ts`, wrap Redis type mismatches so the node reports e.g. `Variable "ticker" already holds a list; Set operations require a set (delete the key or change Data Type)` instead of the raw Redis string.
- `services/storage/configs/store.ts`: also coerce `ttl` with `Number()`, skip `EXPIRE` unless it is a finite positive integer, and make a TTL failure non-fatal once the write has succeeded.


## Tests

- `coreza-backend/tests/compiledAdapterAsync.test.ts`: an executor with `syncCapable: false` resolves its real result through the adapter; a `syncCapable: true` executor returning a promise still produces the explicit "requires synchronous executor" error; a sync executor returns without awaiting; warm-up suppression short-circuits before execution.
- `coreza-backend/tests/storeNodeTtl.test.ts`: empty/invalid `ttl` never calls `expire`; valid ttl does; `expire` rejection still yields success; `rpush` rejection yields a non-empty error message.

## Technical details

Files: `coreza-backend/src/backtest/compiled/adapters.ts` and its `ExecFn`/`CompiledExecContext` types plus the compiled plan runner (precomputed `isAsyncNode` flag), `coreza-backend/src/nodes/executors/DataSourceExecutor.ts` (`syncCapable = false`), `coreza-backend/src/services/storage/configs/store.ts`, `coreza-backend/src/services/storage/storageService.ts`, and the two test files. No frontend or schema changes.
