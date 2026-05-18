# Fix Ichimoku rendering — align backend output shape

## Root cause

The Ichimoku backend has two code paths emitting **different keys** for the same indicator:

- Incremental updater (`coreza-backend/src/nodes/logic/indicators.ts` line 781) returns `{tenkan, kijun, senkouA, senkouB, chikou}`.
- Historical `calculateIchimoku` (line 1603) returns the raw output of the `technicalindicators` library: `{conversion, base, spanA, spanB}` (no `chikou`).

The Visualize node receives the historical shape, but the frontend registry (and any consumer expecting the incremental contract) only knows `tenkan`/`kijun`/`senkouA`/`senkouB`/`chikou`. Every lookup returns `null` and nothing renders.

## Fix — make the backend consistent (no frontend alias hack)

Treat the incremental updater's shape `{tenkan, kijun, senkouA, senkouB, chikou}` as the canonical contract (already documented, already used by live streaming, matches the standard Ichimoku terminology).

### 1. `coreza-backend/src/nodes/logic/indicators.ts` — `calculateIchimoku`

After calling `IchimokuCloud.calculate(...)`, map each library row to the canonical shape and also compute `chikou` (the library omits it). Chikou Span = current close shifted back by `displacement` bars; align it with the same index as the cloud rows the library returns.

Outline (around lines 1600-1614):

```text
const closes = candles.map((c) => Number(c.c ?? c.close));
const raw = IchimokuCloud.calculate({ high, low, conversionPeriod: conv, basePeriod: base, spanPeriod: span, displacement: disp });

// Library returns rows starting at index (basePeriod - 1); preserve that offset.
const offset = candles.length - raw.length;
const mapped = raw.map((r, i) => {
  const candleIdx = offset + i;
  const chikouIdx = candleIdx + disp; // chikou plots current close shifted forward in time = read close from `disp` bars ahead
  const chikou = chikouIdx < closes.length ? closes[chikouIdx] : null;
  return {
    tenkan: r.conversion ?? null,
    kijun: r.base ?? null,
    senkouA: r.spanA ?? null,
    senkouB: r.spanB ?? null,
    chikou,
    timestamp: candles[candleIdx]?.t ?? candles[candleIdx]?.timestamp,
  };
});

return createSuccessOutput(mapped, { ...INDICATOR_CONTEXT, nodeName: "Ichimoku" });
```

Notes:
- Verify the exact direction the project uses for Chikou (some implementations shift backwards instead). Match whatever the incremental updater at line 781 produces so historical + live stay identical (the user's existing memory rule: "identical warmup/live").
- Adding `timestamp` is optional but lines Ichimoku up with the other indicators (RSI/MACD already include it).

### 2. `coreza-backend/tests/indicators/golden/ichimoku.golden.json`

Regenerate via `coreza-backend/tests/indicators/generateGolden.ts` so the parity test (`ichimoku.parity.test.js`) and incremental parity test (`indicatorIncrementalParity.ichimoku.test.ts`) pass against the new keys.

### 3. No frontend changes

`src/utils/indicatorRegistry.ts` already declares `tenkan`/`kijun`/`senkouA`/`senkouB`/`chikou`. Once the backend emits those keys, the chart renders without any alias mechanism.

## Verification

- Open Visualize with `{{ $('Ichimoku').json.data }}`, Indicator = Ichimoku → five lines on the price chart (Tenkan, Kijun, Senkou A, Senkou B, Chikou).
- Run `coreza-backend` indicator parity tests: incremental vs historical must produce identical values at every index now that both emit the same keys.
- Live streaming path unchanged — incremental updater already produced canonical keys.
- ADX / MACD / BB / RSI / S&R unaffected.
