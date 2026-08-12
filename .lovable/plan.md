# Fix: `normalizeSymbol is not a function` — rolling-window module name collision

## Root cause

Two modules in `coreza-backend/src/engine/` differ only by the case of their first letter:

- `src/engine/RollingWindow.ts` — the `RollingWindow` class.
- `src/engine/rollingWindow/index.ts` — the helper module exporting `normalizeSymbol`, `normalizeTimeframe`, `clampWindowSize`, `parseCandleData`, `buildRollingWindowPayload`, `ROLLING_WINDOW_ERRORS`.

`IndicatorsExecutor.ts` imports both:

```ts
import { RollingWindow } from "../../engine/RollingWindow";
import { buildRollingWindowPayload, normalizeSymbol, ... } from "../../engine/rollingWindow";
```

On the Windows dev machine the filesystem is case-insensitive, so the bundler/loader resolves `../../engine/rollingWindow` to the **file** `RollingWindow.ts` (a file match wins over the directory, and the case difference is ignored) instead of `rollingWindow/index.ts`. The resulting namespace object only has the class, so `import_rollingWindow.normalizeSymbol` is `undefined` — hence the throw at `IndicatorsExecutor.ts:367` inside the compiled backtest VM. The same code path works on case-sensitive Linux, which is why it only surfaces locally.

## Fix — rename the helper module so no case-only collision exists

1. Move `src/engine/rollingWindow/index.ts` to `src/engine/rollingWindowHelpers.ts` (single file, same contents, same exports) and delete the now-empty `src/engine/rollingWindow/` directory.
2. Update the three importers to the new path:
   - `src/nodes/executors/IndicatorsExecutor.ts` (helper import block, lines 24-31)
   - `src/routes/storage.ts` (same helper import block)
   - `tests/rollingWindowHelpers.test.ts`
3. Leave `src/engine/RollingWindow.ts` and every `RollingWindow` class import untouched.
4. Do not re-export the helpers from `src/engine/index.ts` — keeping them on an explicit path avoids reintroducing an ambiguity and keeps the engine barrel unchanged.

Rename is preferred over adding an explicit `/index` suffix to the import: the suffix would fix these two call sites but the directory would stay a landmine for the next import, and case-only sibling names also break case-insensitive git checkouts.

## Verification

- `npx tsc --noEmit` shows no new errors and no unresolved-module errors for the three touched files.
- `npx jest tests/rollingWindowHelpers.test.ts` passes against the new path.
- Re-run the backtest activation that produced the trace; `executeRollingWindowNode` should reach the `get`/`set` branches instead of throwing.

## Note (separate, still open)

`OrderResult` is still missing from the `./interfaces` import block in `src/backtest/simBroker/index.ts`, so that file reports `TS2304: Cannot find name 'OrderResult'` at line 205. It is unrelated to this crash but should be re-added in the same pass.
