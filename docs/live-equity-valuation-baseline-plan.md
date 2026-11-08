# Live equity valuation and chart baseline plan

Status: proposed implementation only
Target branch: dev
Scope: minimal live-portfolio and live-chart changes. No implementation or automated test changes in this commit.

## Problem and verified evidence

A Binance spot buy fills in two parts:
- 0.3724 ETH at 2233.78, notional 831.859672.
- 0.6276 ETH at 2233.88, notional 1401.983088.
- Total quantity 1 ETH; acquisition cost 2233.842760.

PortfolioManager.applyOrderEvent currently uses the latest execution price as the holding mark unless a newer mark is present. The whole ETH is valued at 2233.88, creating unrealized P&L of +0.037240 immediately after entry. This is a last-fill valuation effect, not an accounting reconciliation failure.

The supplied snapshots reconcile to initial capital 10021.45 plus cumulative realized and unrealized P&L:
- 10:52: equity 10021.487240, realized 0, unrealized +0.037240.
- 10:53 partial exit: equity 10020.647240, realized -0.71887158, unrealized -0.08388842.
- 10:53 final exit: equity 10020.627385, realized -0.822615, unrealized 0.
- 10:54 next entry: equity 10020.631109, realized -0.822615, unrealized +0.003724.
- 10:55 final exit: equity 10019.817485, realized -1.632515, unrealized 0.

The chart has a separate inconsistency: one-sample bars compare with the previous bucket close; multi-sample candles compare their first and last observations. Two snapshots in the 10:53 bucket therefore change the visual comparison despite the return histogram continuing to use the previous bucket close.

## Intended behavior

1. Distinguish acquisition cost from an independent market valuation.
2. When no sufficiently recent independent market mark exists, use average acquisition cost as the entry valuation fallback. Partial-fill price sequencing alone must not manufacture entry gains.
3. Preserve actual market-driven unrealized changes, fee effects, net inventory adjustments, realized P&L, and both buy and sell snapshots.
4. Live equity-change candles consistently compare the bucket close with the previous observed bucket close, or recorded initial capital for the first bucket.
5. Keep raw observed OHLC separate from the displayed comparison baseline.

Average-cost fallback is a deliberate valuation policy, not a claim that the last execution price was mathematically invalid. Equity remains an estimate between independent market observations. Do not force all buys to zero: fees, pre-existing inventory and valid market marks can cause real changes.

## 1. Separate fill accounting from valuation fallback

Primary file: coreza-backend/src/simulation/PortfolioManager.ts

- Keep normalizeFill, execution quantity/notional, cash debits/credits, exact cost allocation, inventory resolver, execution deduplication and closed-trade aggregation unchanged.
- Audit all positionMarkTimes writers. It currently receives both fill timestamps and independent mark timestamps.
- Give the existing timestamp map one meaning: independent market/broker-position mark time. Do not advance it merely because a fill arrived. Rename only if necessary for clarity.
- Continue updating mark timestamps from updateMarketPrices and broker position reconciliation. Preserve bootstrap marks only with their actual known provenance and time.
- Preserve the existing ordering protection for a valid independent mark newer than the incoming execution. Do not introduce a background fetch, timer or arbitrary freshness TTL.
- If no qualifying independent mark exists:
  - BUY: derive fallback currentPrice from the resulting exact open cost divided by net inventory quantity.
  - Partial SELL: preserve the remaining holding's previous valuation price, rather than re-marking it from the sell execution price.
  - Full SELL: remove the position and mark metadata as today.
- Derive market value and unrealized P&L from the selected mark and exact remaining quantity/cost through the existing decimal helpers.
- For base-asset fees or Alpaca net-received inventory reductions, ensure the fallback does not capitalize away the entry loss: fallback unit price must use the gross execution cost basis per gross acquired units (including prior inventory as applicable), while the remaining exact cost stays allocated to net inventory. Implement this bounded fee-aware fallback explicitly; do not blindly use net-inventory average cost when a base fee exists.
- Quote fees must still reduce cash immediately. Do not offset or suppress them to obtain a flat entry.
- Clear mark metadata on close/destroy using the existing lifecycle.

For fee-free fresh entries without an independent market mark, fallback holding value equals purchase cost. For a partial sell under that fallback, realized loss and remaining unrealized valuation remain separately attributable.

## 2. Use a consistent baseline for live chart display

Primary file: src/components/backtest/EquityHistoryChart.tsx
Supporting files only if needed: src/lib/equityChartData.ts and src/components/backtest/equityChartTypes.ts

- Reuse returnBaseline and returnPct already computed by buildEquityChartData.
- Apply the comparison-bar transformation to all LIVE buckets, irrespective of sampleCount.
- Display open = returnBaseline when available; display close = observed bucket close.
- Include both the baseline and all observed extremes in display high/low:
  - high = max(observed high, displayed open, close).
  - low = min(observed low, displayed open, close).
- Choose color from the same returnPct used by the blue histogram: positive green, negative red, zero/unavailable neutral.
- With no valid baseline, show observed values neutrally and label the comparison unavailable. Do not invent initial capital or a zero return.
- Preserve gaps and existing return-spans-gap handling.
- Pass live-mode behavior into both normal rendering and theme-refresh paths.
- Preserve backtest observed OHLC candle semantics and existing one-sample behavior.

Do not overwrite model OHLC with display-adjusted OHLC. The baseline endpoint is a comparison reference, not an observation made during the bucket.

## 3. Align explanatory text and inspection

Primary file: src/components/backtest/EquityHistoryChart.tsx

- For live mode, describe every candle as an equity-change comparison against the previous observed bucket, with initial capital used for the first when available.
- Show comparison baseline and total equity change in tooltips for multi-sample live buckets as well as sparse ones.
- Keep the inspection table's Open/High/Low/Close as observed values. Clearly label them observed OHLC so readers can distinguish them from the displayed baseline.
- Keep sample counts and status accurate.
- Explain that a cost-based fallback is used until a qualifying market valuation exists. Keep this brief and specific to live results.
- Do not add win/loss labels to equity candles or use a display tolerance to hide small genuine changes.

## Scope boundaries and historical behavior

- No schema changes, migration, new dependencies or broker API calls.
- No changes to cash, trade P&L, fees, fill records, execution identity, or workflow node mappings.
- No automatic rewrite of existing snapshots. Old snapshots retain their last-fill valuation gains; updated live chart comparisons can display them consistently.
- New backend valuation behavior applies to fills processed after deployment. Use a fresh activation for a clean comparison.
- Existing independent market data can still produce a green entry snapshot. The objective is to remove fill-price-only valuation drift, not to prohibit unrealized profit.

## Review and manual acceptance

No automated test additions are planned. Implementation verification should be limited to focused review and manual checks:
- Replay the supplied two-part fee-free entry: cost 2233.842760, fallback value 2233.842760, entry unrealized P&L 0.
- Close at proceeds 2233.020145: cumulative realized P&L -0.822615 and no open position.
- Replay the next fee-free entry: no +0.003724 fallback gain.
- Confirm partial exits preserve the remaining valuation; a complete close reconciles cash to starting capital plus cumulative realized P&L.
- Confirm genuine independent market marks still affect unrealized P&L and are protected from stale fills.
- Confirm quote fees, base-asset fees and Alpaca net inventory retain their economic equity loss.
- Confirm one- and multi-sample live buckets use the same baseline, and adding a second observation does not silently switch comparison semantics.
- Confirm tooltip/table distinctions, gaps, unavailable baselines and theme refresh.
- Confirm backtest candle behavior remains unchanged.

## Minimal implementation order

1. Audit mark provenance and implement the fee-aware live valuation fallback.
2. Make live candle baseline rendering consistent across normal and theme updates.
3. Update the corresponding tooltip, table labels and short explanation.
4. Review the supplied numeric reconciliation and the focused manual cases above.
