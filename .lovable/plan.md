# Why Support & Resistance overlay does not render

## What the data looks like

From the Input Data panel for the Support & Resistance node:

```text
data: [
  {
    pivot: 0.2281,
    resistance: [0.2410…, 0.2489…, 0.2619…],
    support:    [0.2202,   0.2072…, 0.1993…]
  }
]
```

The user drags `{{ $('Support & Resistance').json.data }}` into the overlay, so the resolved value is the **array above** (length 1), not the inner object.

## How the overlay classifier handles it today

`src/utils/visualizeNormalize.ts > classifyOverlay` has two branches for detecting "levels":

1. **Object branch** — if `resolved` is a plain object with `support` / `supports` / `resistance` / `resistances` arrays → classify as `levels`. Works.
2. **Array branch** — if `resolved` is an array → call `parseLevelsArray(arr)`, which expects each entry to look like `{ type: "support" | "resistance", level: number, time? }`.

The S&R payload is an array of **summary objects** (`{ pivot, support: [...], resistance: [...] }`), not an array of typed level rows. So:

- It fails the object branch (it is an array, not an object).
- `parseLevelsArray` finds no `type: "support" | "resistance"` entries and returns empty supports/resistances.
- `levels` ends up `null` → falls through to bands check (no `upper`/`lower`) → falls through to `hasNonOverlappingRange` / line. The data has no per-candle time series, so `alignSeriesToCandles` produces all-null points and nothing visible is drawn.

That is why BB renders (its `data` is an array of `{ upper, middle, lower }` per bar, which the bands array-branch handles) but S&R does not.

## Fix

In `src/utils/visualizeNormalize.ts`, extend the **array branch** of the `levels` detector to also accept "summary-row" shapes. Concretely, before calling `parseLevelsArray(arr)`:

- If `arr[arr.length - 1]` (use the latest row) is an object that contains any of `support`, `supports`, `resistance`, `resistances` as arrays, treat that row exactly like the existing object branch:
  - `supports = row.support ?? row.supports ?? []`
  - `resistances = row.resistance ?? row.resistances ?? []`
  - Coerce with `toFiniteNumber`, filter nulls, return `{ kind: "levels", supports, resistances }`.
- Only fall back to `parseLevelsArray(arr)` when no summary-row shape is found.

No other files need changes. `lightweightSeriesBuilder` already renders `kind: "levels"` with `supports` / `resistances` (the price-line markers seen in the BB chart screenshot).

## Verification

1. Drag `{{ $('Support & Resistance').json.data }}` into an overlay row, leave render as Auto.
2. Expect 3 resistance price lines (≈0.241, 0.249, 0.262) and 3 support price lines (≈0.220, 0.207, 0.199) drawn across the chart, labelled "Overlay N support/resistance".
3. BB overlay must continue to render as bands (regression check).
4. Dragging `{{ $('Support & Resistance').json.data[0] }}` (object form) must keep working — it already hits the object branch.

## Out of scope

No changes to `LightweightVisualizeChart`, `RepeaterNodeLayout`, drag/drop hooks, or backend.
