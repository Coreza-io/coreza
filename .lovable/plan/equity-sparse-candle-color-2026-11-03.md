# Color one-sample equity candles by period return

## Problem

A live equity bucket with one sample has identical open, high, low, and close. The renderer treats the flat candle as an up candle, even when portfolio equity fell between observed buckets. In the reported 1:39 PM UTC example, all four values were $1,010,249.60 and the period return was −0.00023%, yet the candle was green.

## Implementation

1. In `src/components/backtest/EquityHistoryChart.tsx`, add a display-only color override when preparing candle data for a bucket with `sampleCount === 1`. Use the existing unrounded `returnPct` from `src/lib/equityChartData.ts`. A negative return uses the theme's down color, a positive return uses the up color, and zero or null uses a neutral gray. Apply the same override to the candle body, border, and wick so the flat mark takes the intended color.
2. Read colors from the existing theme palette and refresh the per-candle overrides through the existing theme update path. Leave multi-sample candles on the renderer's normal open-to-close rule. Apply the one-sample rule in both Live and Backtest wherever the shared component displays candles.
3. Add a short explanation to the candle chart caption. One-sample marks use period return, while multi-sample candles use open-to-close direction. Keep the existing tooltip and gap metadata. The period return compares with the previous observed close, or with initial capital for the first bucket when available.
4. Keep the change in the frontend chart presentation. Reuse stored OHLC and the existing return calculation. Preserve the line series, blue return histogram, and Trade Log P&L behavior.

## Acceptance checks

- Reproduce the reported bucket with one sample and a return of −0.00023%. The mark is red and the tooltip still reports the same OHLC and return.
- A positive one-sample return renders green. A zero return and a first bucket without a valid baseline render gray.
- A one-sample bucket following a gap uses the existing return over that gap. The tooltip retains its gap indication.
- A multi-sample candle that closes above its open but below the previous bucket close remains green. The negative return bar stays below zero.
- Switching between light and dark themes updates the mark colors. Switching chart type or interval and refreshing a live bucket applies the rule to the currently displayed data.
