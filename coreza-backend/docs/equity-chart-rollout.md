# Equity chart selector rollout

## Line-mode cumulative return amendment

Line mode now shows blue portfolio equity and orange cumulative return, as
explicitly requested after the sparse-candle follow-up. Cumulative return equals
100 * (current equity / initial capital - 1), using the selected run's existing
recorded or inferred baseline. Unknown/nonpositive capital yields unavailable
returns; invalid equity leaves gaps, and genuine zero remains valid. The legend,
axis and tooltip name the cumulative metric and preserve tiny-return precision.
The equity axis uses a padded observed range, including a flat-series fallback,
with wider tick-label space and an explicit scale caption. Original instructions
to keep Line's period-return semantics are superseded by this request.

Candle keeps bucket-to-bucket percentage returns; saved daily_return, OHLC,
metrics, trading, loaded observations and subscriptions are unchanged. No new
migration is required. This cumulative measure can be affected by cash movements.
No tests or visual validation were run; type-check findings are recorded in the PR.


## Sparse daily backtests

The inspected daily-data run has 675 saved daily rows, each with one observed
valuation. Equal daily O/H/L/C is correct for that data. Daily market-bar highs
and lows do not establish portfolio-equity extrema, especially across assets.

Backtest Candle now offers Auto, 1D, 1W and 1M. Auto keeps 1D when daily rows
already contain multiple observations; for single-observation daily history it
selects 1W (or 1M when only monthly grouping combines observations). If no grouping
combines observations, Auto keeps 1D. Explicit choices are never changed by zoom.

Weeks start Monday 00:00 UTC; months use UTC calendar boundaries. Coarser candles
aggregate saved daily OHLC, sum sample counts and recompute returns from closes.
The chart labels the sampling basis and explains single-sample daily dojis above
the canvas. Existing Line values and the daily reporting rows remain unchanged.
This is observed weekly/monthly equity, not recovered intraday equity. Rerun with
intraday inputs to obtain observed ranges within each day. No historical backfill,
additional market-data requests or trading changes are introduced. Backtests
without saved OHLC retain their existing unavailable-Candle behavior.

The follow-up uses existing persisted data and requires no additional migration.
Source/TypeScript review only; no tests or performance benchmarks were run.

The results page defaults to the existing Line view. A user-scoped, versioned
local preference can select Candle. Live candles use the already selected
account/currency snapshot series and shared equity normalization; returns are
percentage points computed from bucket closes, not summed snapshot returns.
The first return uses recorded initial capital when available, otherwise the
existing inferred live capital with its label. Cash movements can affect returns.

## Deployment order

1. Apply `20261028083211_portfolio_equity_ohlc.sql` through the normal migration
   deployment process. It adds five nullable columns and a consistency constraint
   without changing RLS, grants, row identity or historical values.
2. Confirm all five columns are present before deploying the backend writer.
   Finalization checks readiness before reporting writes and reports a missing
   migration instead of completing a run with discarded equity observations.
3. Deploy the backend and frontend. Run a new backtest to capture actual OHLC.
   Completed older backtests are not rewritten; incomplete OHLC coverage keeps
   Candle unavailable. Stepped and automatic finalization share the same writer.

The original implementation inspection found the columns missing. The later
sparse-candle investigation confirmed all five OHLC columns are now present
in the connected project. This change does not apply a remote migration, deploy
services or run trading workflows. Apply the migration before enabling the writer.

## Review and rollout gates

Tests were not run, following the user's no-testing instruction. Automated adapter,
persistence, browser, screenshot and 100k-row performance gates from the design
remain outstanding; no performance numbers or visual equivalence are claimed.
Type checks are recorded in the PR, including any existing repository failures.

The follow-up source review corrected Strict Mode cleanup that mutated the
memoized crosshair lookup, whole-bar range rounding on refresh, and capability
checks that considered obsolete same-instant duplicates. Results now wait for
the selected run before reading settings or mounting a chart, while same-run
refresh keeps its chart mounted. Live sanitation counts are carried into chart
diagnostics rather than disappearing before aggregation. Bucket table controls
wrap on narrow screens.

The reviewed automatic and stepped paths share finalization; daily OHLC stays in
the existing upsert with the final cash/stock/close and unchanged daily-return
calculation. The migration retains existing scope guards/RLS and adds no client
write grants. A fresh read-only schema inspection still found none of the five
OHLC columns: deployment readiness remains outstanding. No remote changes were
made during this review.

A second review also corrected percentage-axis tick resolution for tiny returns
(the formatter alone left the library's default 0.01 step), and observes actual
root theme changes so initial provider timing cannot leave stale canvas colors.
The live loader refuses a known header/selected-series currency mismatch before
publishing chart or metric data. These corrections were source/type reviewed;
the unrun browser and deployment gates above still apply.

Before rollout verify observed OHLC survives save/reload, retry preserves the same
daily row and close/return metrics, Line remains visually equivalent, and live
refresh/navigation cannot mix executions/accounts/currencies. Check Strict Mode,
resize/theme changes, keyboard controls, blocked storage, tooltip gaps, long-run
pan/zoom, sparse/provisional state and the accessible paginated bucket table.

The canvas uses Lightweight Charts 5.2.0 native panes and preserves attribution.
All loaded observations stay available; Auto selects at most 1,000 nonempty
buckets where possible. Longer daily histories initially show a recent window;
pan or All / reset accesses the complete series. Refresh preserves the visible
time range; changing interval may reset it. Switching Line/Candle can reset the
viewport but does not fetch data or alter execution/subscriptions.

Rollback the frontend to Line and the writer to the previous version while
retaining the nullable columns and captured OHLC. Do not drop historical data.
