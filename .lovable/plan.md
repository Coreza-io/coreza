# Why MACD (and most multi-channel indicators) don't render + fix via Indicator Type dropdown

## Root cause — MACD specifically

The MACD payload dragged into the overlay row is an array of objects:
```text
[ { macd: 0.0046, signal: 0.0046, histogram: 0 }, { macd: 0.0049, signal: 0.0013, histogram: 0.0036 }, ... ]
```

The current pipeline fails it in two stacked ways:

1. **Classification (`src/utils/visualizeNormalize.ts > classifyOverlay`)**
   - Not "bands" (no `upper`/`lower` keys on rows).
   - Not "levels" (no `type: support|resistance` and no `{support, resistance}` summary).
   - `OSCILLATOR_NAMES` check uses the overlay **row name**, which the user set to `BB(20,2)` (a label, not an indicator id). So the `macd` token is never matched and it does NOT classify as `panel`.
   - Falls through to `hasNonOverlappingRange` → `alignSeriesToCandles` with an array of objects with no `time`/`value` → all nulls → returns false.
   - Final classification: `line`.

2. **Per-row value extraction (`alignSeriesToCandles` → `normalizeSeriesPoint`)**
   - Only knows the keys `value`, `v`, `level`, `close`, `c`. It does not know about `macd`, `signal`, `histogram`, `k`, `d`, `adx`, `plusDI`, `tenkan`, etc.
   - Even if classification were `panel`, every point would resolve to `null` and nothing would draw.

## Why the same problem hits other indicators

Every indicator whose row payload uses a custom field name has the same issue:

| Indicator | Row shape (historical array) | Currently renders? |
|---|---|---|
| RSI | `number[]` or `{value}[]` | line (wrong — should be panel with 30/70 guides) |
| EMA / SMA / VWAP | `number[]` | line on price ✓ |
| MACD | `{macd, signal, histogram}[]` | broken |
| BB | `{upper, middle, lower}` arrays | bands ✓ (only because keys match) |
| ADX | `{adx, plusDI, minusDI}[]` | broken |
| Stoch | `{k, d}[]` | broken |
| OBV | `number[]` | line on price (wrong — should be panel) |
| Volume Oscillator / PVO | `number[]` | line on price (wrong — should be panel) |
| Ichimoku | `{tenkan, kijun, senkouA, senkouB, chikou}[]` | broken |
| Support & Resistance | `[{pivot, support, resistance}]` | levels ✓ (fixed earlier) |

The classifier was relying on either fixed key names (BB, S&R) or substring matches on a user-provided label. That is fragile and cannot disambiguate channels for multi-line indicators.

## Fix — explicit Indicator Type dropdown + a frontend Indicator Registry

Make the indicator type **explicit** on every overlay row. The dropdown both tells the chart how to render and tells the extractor which fields to pull.

### 1. UI: add an `indicatorType` field to overlays

`src/nodes/Visualize.json` — extend the `overlays` repeater `subFields` with a new `select` placed before `render`:

```json
{
  "key": "indicatorType",
  "label": "Indicator",
  "type": "select",
  "options": [
    { "id": "auto", "name": "Auto detect" },
    { "id": "rsi", "name": "RSI" },
    { "id": "ema", "name": "EMA" },
    { "id": "sma", "name": "SMA" },
    { "id": "macd", "name": "MACD" },
    { "id": "bb", "name": "Bollinger Bands" },
    { "id": "adx", "name": "ADX" },
    { "id": "stoch", "name": "Stochastic" },
    { "id": "vwap", "name": "VWAP" },
    { "id": "obv", "name": "OBV" },
    { "id": "volume_oscillator", "name": "Volume Oscillator" },
    { "id": "pvo", "name": "PVO" },
    { "id": "ichimoku", "name": "Ichimoku" },
    { "id": "support_resistance", "name": "Support & Resistance" }
  ],
  "default": "auto"
}
```

Default is `auto` so existing workflows keep working. When set to a specific indicator, registry-driven rendering takes over.

### 2. New registry: `src/utils/indicatorRegistry.ts`

Single source of truth describing each indicator's render kind, channels, default colors, panel placement, and optional reference levels. Shape:

```text
type IndicatorChannel = {
  key: string;             // field on each row (e.g. "macd", "signal", "histogram")
  label: string;           // legend text suffix
  color: string;           // default color, overridable by row.color for primary channel
  style?: "line" | "histogram";
  dashed?: boolean;
};

type IndicatorSpec = {
  id: string;
  label: string;
  pane: "price" | "panel";
  kind: "line" | "bands" | "levels" | "multi";
  channels: IndicatorChannel[];        // for line / multi
  bands?: { upper: string; middle?: string; lower: string };  // for bands
  levels?: { supports: string; resistances: string };          // for levels
  referenceLines?: Array<{ price: number; color: string; label?: string }>;  // e.g. RSI 30/70
};
```

Entries:
- `rsi` → panel, multi, channels `[{key:"value"|number,...}]`, referenceLines 30/70.
- `ema` / `sma` / `vwap` → price, line, single numeric channel.
- `macd` → panel, multi, channels `macd` (line), `signal` (dashed line), `histogram` (histogram).
- `bb` → price, bands `{upper, middle, lower}`.
- `adx` → panel, multi, channels `adx`, `plusDI`, `minusDI`.
- `stoch` → panel, multi, channels `k`, `d`, referenceLines 20/80.
- `obv` → panel, line, single numeric.
- `volume_oscillator` / `pvo` → panel, line, single numeric.
- `ichimoku` → price, multi, channels `tenkan`, `kijun`, `senkouA`, `senkouB`, `chikou`.
- `support_resistance` → price, levels `{support, resistance}` (delegates to existing levels path).

### 3. Extend chart types and the series builder

`src/components/charts/chartTypes.ts`
- Add a new overlay kind `multi`:
  ```text
  | { kind: "multi"; id; name; pane: "price"|"panel"; channels: Array<{ label; color; style: "line"|"histogram"; data: SeriesPoint[] }>; referenceLines?: Array<{ price; color; label? }> }
  ```

`src/components/charts/lightweightSeriesBuilder.ts`
- Add a `multi` branch in `addOverlaySeries` that loops over `channels` and adds a `LineSeries` or `HistogramSeries` per channel, returning all created series in `handles.series`.
- Apply `referenceLines` as `createPriceLine` on the first added channel series (and push into `handles.priceLines` so existing cleanup works).

### 4. Preview wiring: `src/components/nodes/visualize/VisualizeNodePreview.tsx`

- Add `indicatorType` to the `OverlayRow` type.
- When `row.indicatorType && row.indicatorType !== "auto"`:
  - Look up spec from registry.
  - If `spec.kind === "bands"`: extract each band array (`rows.map(r => r[spec.bands.upper])` etc.) and push a `bands` overlay (reuses existing rendering).
  - If `spec.kind === "levels"`: read from the latest row using `spec.levels.supports`/`spec.levels.resistances` (covers the S&R summary shape). Reuse existing `levels` overlay.
  - If `spec.kind === "line"`: extract single channel as numeric series, push `line` or `panel` overlay according to `spec.pane`.
  - If `spec.kind === "multi"`: for each channel, build `SeriesPoint[]` by extracting `row[channel.key]` from each row in the array, aligned to candle tail. Push one `multi` overlay with all channels and `spec.referenceLines`.
- When `row.indicatorType === "auto"` or missing, keep current `classifyOverlay` path so old workflows continue to render.

### 5. Make field extraction tolerant of nested shapes

In the registry path, before reading `row[channel.key]`, unwrap common wrappers so users can drag either the raw array, `$('MACD').json.data`, `currentValue`, etc.:
- If `resolved` is `{ data: [...] }` use `.data`.
- If each row has `{ value: { macd, signal, histogram } }`, descend into `.value`.
- If a row has `time`/`t`/`timestamp`, prefer it; otherwise tail-align numerically to candles (same as existing `alignSeriesToCandles`).

### 6. Backwards compatibility and defaults

- `indicatorType` default `auto` keeps the existing classifier path live.
- Existing rows without the field behave exactly as today.
- Color: `row.color` overrides the primary channel only; secondary channels keep registry colors so MACD signal/histogram remain visually distinguishable.

## Verification

1. Drag `{{ $('MACD').json.data }}`, set Indicator = MACD → panel shows MACD line, signal line, histogram. No console errors.
2. Drag `{{ $('BB').json.data }}`, Indicator = Bollinger Bands → 3 lines around price (regression).
3. Drag `{{ $('RSI').json.data }}`, Indicator = RSI → panel with single line + dashed 30 and 70 reference lines.
4. Drag `{{ $('Stochastic').json.data }}`, Indicator = Stochastic → panel with K and D + 20/80 reference lines.
5. Drag `{{ $('ADX').json.data }}`, Indicator = ADX → panel with adx, +DI, -DI lines.
6. Drag `{{ $('Ichimoku').json.data }}`, Indicator = Ichimoku → 5 lines overlaid on price.
7. Drag `{{ $('OBV').json.data }}`, Indicator = OBV → panel with single line.
8. Drag `{{ $('VWAP').json.data }}`, Indicator = VWAP → line overlaid on price.
9. Support & Resistance row still works (Indicator = Support & Resistance or Auto).
10. Leaving Indicator = Auto keeps the BB / S&R / numeric-array cases rendering as before.
11. Switching Indicator on an existing row updates without leaking series or price lines (uses existing `OverlayHandles` cleanup).

## Files touched

- `src/nodes/Visualize.json` — add `indicatorType` select.
- `src/utils/indicatorRegistry.ts` — new registry.
- `src/components/charts/chartTypes.ts` — add `multi` overlay kind.
- `src/components/charts/lightweightSeriesBuilder.ts` — add `multi` branch + reference lines.
- `src/components/nodes/visualize/VisualizeNodePreview.tsx` — registry-driven build path with `auto` fallback.

## Out of scope

Backend indicator code, drag-and-drop hooks, repeater layout, reference resolution, normalizeOutput.
