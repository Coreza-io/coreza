# Equity chart selector rollout

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

The connected project's schema was inspected during implementation and does not
yet contain these columns. This change does not apply a remote migration, deploy
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
