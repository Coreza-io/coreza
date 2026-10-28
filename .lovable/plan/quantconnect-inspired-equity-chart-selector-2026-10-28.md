# Coreza equity chart: selectable Line and Candle views

Date: 2026-10-28
Target branch: `dev`
Status: reviewed design specification. PR #871 and sparse-daily PR #872 are merged. The user-approved Line-mode amendment below is a follow-up; browser and performance validation remain outstanding.
Coreza baseline reviewed: `34e19cf0088a7566848398aa44f3f424121aae7d`.

## Current user-approved presentation (supersedes earlier Line amendments)

Both modes use the same native two-pane chart, selected interval, UTC buckets,
period-return histogram, crosshair, theme, visibility/reset controls and accessible
bucket table. Line shows a blue line through each bucket's closing equity in the
upper pane. Candle shows portfolio-equity OHLC in that pane. Both show blue
period-return bars below: 100 * (bucket close / previous observed bucket close - 1),
using validated initial capital for the first bucket when available. There is no
orange cumulative-return overlay. The equity scale remains autoscaled to visible
observations. Both modes expose the interval selector; switching types does not
fetch or alter execution. A type switch may reset the viewport; refresh preserves it.

Use one shared EquityHistoryChart renderer. Remove the separate Recharts Line
renderer and old Candle-only component. Line may read historical daily closes
when full OHLC is missing; show only equity/return values and label that basis.
Candle remains disabled without complete OHLC coverage. Do not expose synthetic
OHLC or invented observation timestamps for close-only history. This change needs
no database migration or backend changes. The original Recharts-preservation and
later cumulative-return requirements below are historical and superseded by this
latest user request. Tests and browser/performance validation remain unrun.

## 1. Requested outcome

Add a chart-type selector to the Equity Curve card shown in the first supplied screenshot. Offer **Line** and **Candle** on both backtest and live/streaming results.

- **Line:** blue closing-equity line in the upper pane and blue period-return bars below, using the shared chart renderer and interval controls described above.
- **Candle:** introduce a QuantConnect-inspired layout: portfolio-equity candlesticks in the upper pane and blue percentage-return bars in a smaller lower pane, with a shared time axis and crosshair tooltip.
- Keep Coreza's card, theme, typography, spacing, and currency conventions. Treat the second screenshot as interaction/layout inspiration, not a pixel copy.
- This is an equity chart, not a security-price chart. Candle OHLC must come from portfolio valuations; symbol OHLC and trade execution prices cannot substitute for equity observations.

Default to Line for compatibility. Remember an explicit user choice locally. The original document was a plan-only delivery; this revision records the implemented follow-up interval policy without claiming completed deployment or validation.

### Superseded cumulative-return amendment (historical)

The user subsequently requested blue equity and orange cumulative growth in Line mode. Cumulative return is `100 * (current normalized equity / initial capital - 1)` in percentage points, not a sum of daily returns. Use the selected run's recorded initial capital, or the existing inferred live capital with its label; missing, nonfinite or nonpositive capital produces an unavailable series. Never silently substitute the first displayed observation. Preserve genuine zero equity and leave invalid values as gaps.

Use a padded equity range based on finite observed values and a safe nonzero range for a flat series. Explicitly disclose that the axis scales to observed values. The right axis, legend and tooltip say Cumulative Return %, with sign-preserving precision for tiny values. This amendment supersedes earlier instructions to preserve Line's daily/period-return semantics or its original screenshot exactly. Candle OHLC, period returns, buckets, persistence and execution are unaffected. External cash movements can affect this cumulative metric; it is not flow-adjusted performance.

This amendment is source/type reviewed only. Tests, browser screenshots and performance gates remain unrun. PR #871 and sparse-daily follow-up #872 have been merged; the Line-mode amendment is a separate follow-up.

## 2. What QuantConnect actually does

Research checked the current public LEAN source, official documentation, and the supplied reference image.

### Verified engine behavior

At LEAN master `22404ea28b8d3f3c9eb74d6ed9f0444426f8e417`:

1. `Engine/Results/BaseResultsHandler.cs` initializes Strategy Equity with an Equity `CandlestickSeries` at index 0 and a Return `SeriesType.Bar` series at index 1, using currency and percent units respectively.
2. `UpdateAlgorithmEquity` feeds observed portfolio value into the current aggregated equity bar. `SampleEquity` emits that bar as a candlestick and resets the accumulator.
3. `Engine/Results/BacktestingResultHandler.cs::ProcessSynchronousEvents` updates the equity bar before its sampling check. Chart sampling therefore differs from simply taking one equity close and drawing a candle around it.
4. `BaseResultsHandler.Sample(DateTime)` records periodic performance relative to the preceding daily portfolio value and updates the daily baseline. Return bars and equity sampling are separate series; do not assume every equity candle necessarily corresponds to one daily return sample.
5. `Common/CandlestickSeries.cs` represents explicit open/high/low/close values. Official charting docs distinguish candle series from vertical bar series.

### What the screenshot establishes

The reference image shows green/red equity bodies and wicks, a distinct blue return histogram around zero, right-side scales, and a floating tooltip with date, OHLC, and Return. These are visual observations. Public LEAN code verifies the data model, not the proprietary cloud frontend's exact renderer.

Do not claim that QuantConnect's cloud results page uses Plotly merely because its Research Environment examples use Plotly. The exact cloud frontend library is not established by this investigation and is unnecessary for Coreza's implementation.

### Sources

- [LEAN BaseResultsHandler at reviewed commit](https://github.com/QuantConnect/Lean/blob/22404ea28b8d3f3c9eb74d6ed9f0444426f8e417/Engine/Results/BaseResultsHandler.cs)
- [LEAN BacktestingResultHandler at reviewed commit](https://github.com/QuantConnect/Lean/blob/22404ea28b8d3f3c9eb74d6ed9f0444426f8e417/Engine/Results/BacktestingResultHandler.cs)
- [LEAN CandlestickSeries at reviewed commit](https://github.com/QuantConnect/Lean/blob/22404ea28b8d3f3c9eb74d6ed9f0444426f8e417/Common/CandlestickSeries.cs)
- [QuantConnect charting documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/charting)
- [LEAN result handler API reference](https://www.lean.io/docs/v2/lean-engine/class-reference/classQuantConnect_1_1Lean_1_1Engine_1_1Results_1_1BaseResultsHandler.html)
- [Lightweight Charts v5.2 panes](https://tradingview.github.io/lightweight-charts/docs/panes)

Coreza should adopt the useful two-pane presentation while defining its own explicit, aligned bucket semantics below.

## 3. Findings in Coreza dev

| File | Current behavior | Planned implication |
| --- | --- | --- |
| `src/components/backtest/EquityCurveChart.tsx` | Recharts dual-axis LineChart; monotone equity and return lines; 360px content height | Retain as the Line renderer; add selector and conditional Candle renderer |
| `src/pages/BacktestResults.tsx` | Shared results page; passes snapshots, currency, and intraday=isLive | Supply explicit chart context, run identity, baseline, and capability |
| `src/hooks/useBacktestResults.ts` | Loads paginated portfolio rows ordered by date then id | Extend optional snapshot typing for saved equity OHLC |
| `src/hooks/useLiveStrategyDetail.ts` | Selects an execution and one snapshot source; normalizes equity; computes adjacent-snapshot returns | Build candles from the same selected, normalized series; preserve execution/source boundaries |
| `coreza-backend/src/backtest/session/BacktestSession.ts` | Records equity after timestamp execution, including synchronous and asynchronous paths | Use these observed portfolio valuations; do not add order/execution work |
| `coreza-backend/src/backtest/simBroker/index.ts` | Stores timestamp/equity observations in typed arrays and exposes getEquityCurve | Enough observed data exists during a new run to compute daily OHLC |
| `coreza-backend/src/backtest/BacktestExecutor.ts` | resampleToDaily keeps the final EquityPoint per UTC date; persists close and daily_return | Intraday observed highs/lows are lost before persistence; fix this reduction for future runs |
| `coreza-backend/src/reporting/liveMetrics.ts` and `src/lib/liveMetrics.ts` | Shared live source selection and equity normalization | Reuse the valuation basis; chart aggregation must not invent a second normalization |
| `src/components/charts/LightweightVisualizeChart.tsx` | Existing financial candlestick renderer with separate indicator charts | Useful lifecycle/style reference; do not force portfolio reporting through its price/volume view model |
| `package.json` | Includes lightweight-charts ^5.2.0 and Recharts ^2.12.7 | Reuse the existing dependency; verify resolved lockfile version before implementation |
| `supabase/migrations/20261028000000_shared_strategy_reporting.sql` | Unified portfolio table; backtest date rows unique per strategy; live timestamp/source fields | Add nullable backtest OHLC fields in a new migration, preserving existing row identity and policies |

Important limits:

- Historical backtests with only daily closes cannot recover genuine intraday observed equity highs/lows from those rows.
- Live snapshots can produce sampled equity OHLC, but cannot reveal valuations between snapshots.
- Backtests sampled only daily also have no intraday variation to recover; a doji from one real observation is valid and must be identified as sparse.
- Repository inspection does not establish which migrations are deployed. Verify schema readiness in the target environment during implementation.
- The screenshot's clipped currency ticks and repeated near-zero return labels are presentation issues. Tiny-return formatting belongs in the Candle renderer initially; any Line layout cleanup should be separately reviewed to respect the requested existing Line view.

## 4. UI and interaction specification

### Card header

Place a labelled `Chart type` control at the right of the Equity Curve title, using the existing Select or ToggleGroup primitives.

| Choice | Content |
| --- | --- |
| Line | Existing equity and return line chart |
| Candle | Upper equity candle pane and lower return histogram pane |

Use visible labels, keyboard navigation, accessible selected state, and sufficient touch targets. Wrap controls below the title on narrow screens.

Persist only the chart preference with a versioned, user-scoped localStorage key. Validate stored values; handle unavailable storage and unknown values by falling back to Line. Do not put chart preferences into workflow documents, execution payloads, or reporting metrics.

### Candle layout

- Use one Lightweight Charts instance with two native panes: approximately 75% equity, 25% returns within roughly 420px desktop height; provide a readable mobile minimum.
- Right-side currency scale on top and percentage scale below; independently autoscale the panes.
- Green for close >= open, red for close < open; show fine wicks and visible dojis. Resolve colors from Coreza's theme.
- Blue bars above/below an explicit zero baseline for bucket returns.
- Shared crosshair and time axis. Tooltip contains bucket start/end, currency-labelled OHLC, bucket return, sample count, and provisional/sparse status.
- Tooltip values must come from the hovered bucket. Missing return is an em dash; never reuse a different bucket's last return.
- Provide Equity/Return visibility controls and All/reset view. Keep at least one series visible.
- Support pan/zoom. Fit once on initial data or run change; preserve the user's range during refresh. Switching chart type must not fetch or restart execution.
- First version may reset viewport when switching between Recharts and Lightweight Charts; preserve it within Candle refreshes. Cross-library viewport transfer is deferred.
- Show a concise accessible value summary/table for the canvas view, with latest OHLC/return and an accessible way to inspect displayed buckets.
- Preserve required library attribution under the resolved package's license.

### Bucket control

Show a separate `Interval` control in Candle mode. Interval is independent of Line/Candle choice.

- Backtest: Auto, 1D, 1W and 1M. Persisted input remains UTC daily observed equity OHLC; coarser intervals aggregate those rows without changing persistence or execution.
- Backtest Auto keeps 1D when any usable daily row contains multiple observations. When every usable daily row has one observation, choose 1W if any weekly bucket combines multiple daily rows, otherwise 1M if a monthly bucket combines rows, otherwise retain 1D. Auto does not guarantee every edge/sparse bucket has multiple samples or a nonzero range. Mixed daily sample counts retain 1D; explicit coarser selection remains available.
- Weeks use Monday 00:00 UTC through the next Monday; months use actual UTC calendar-month boundaries, including leap years and December/January rollover. All membership is half-open [start,end).
- Live: Auto, 1m, 5m, 15m, 1h, 1D.
- Auto chooses the smallest supported interval that keeps the full selected run at or below 1,000 nonempty buckets. If even 1D exceeds this target, show a bounded recent window and retain full loaded history for navigation; do not silently discard history.
- Show the resolved interval and `Sampled equity` caption so users know what each candle represents. Explain above the canvas when daily observations are grouped into weeks/months, and when explicit 1D yields O=H=L=C because each day has only one valuation.
- Calendar bucket labels show period boundaries, not proof of complete coverage. The first/last week or month, holidays and gaps may contain fewer observations; sample count describes actual captured valuations. A completed backtest's partial calendar period is not marked live/provisional.
- Zoom does not silently change an explicitly selected interval.

## 5. Deterministic chart data contract

Create a pure, separately testable adapter, proposed `src/lib/equityChartData.ts`, and types in `src/components/backtest/equityChartTypes.ts`.

A candle model should carry: bucket start/end UTC milliseconds, open/high/low/close, nullable returnPct, sampleCount, observed first/last timestamp, isProvisional, and quality (observed or sparse). Convert to chart epoch seconds at the renderer boundary only.

Rules:

1. Resolve authenticated run, mode, execution, broker/credential/currency series before aggregation. Never aggregate distinct sources or currencies together.
2. Reuse existing live normalization exactly once. Ensure the normalized timestamp list and raw row mapping have consistent ordering; the current hook's per-timestamp map and subsequent adjacent-row return loop deserve explicit duplicate/order coverage.
3. Validate dates and finite equity values. Reject missing values instead of coercing them into fictitious zero equity. A real numeric zero is valid.
4. Sort by timestamp with stable row-id tie breaking. Deduplicate exact same-instant samples deterministically (last row in this stable order wins); do not invent chronology between simultaneous valuations. Track diagnostics for invalid and duplicate rows.
5. Fixed UTC buckets and UTC calendar weeks/months use half-open [start,end) membership. A timestamp exactly at the boundary enters the next bucket. Label UTC clearly initially. Browser locale may change text formatting but must not change bucket membership; exchange/session-aligned days are a later explicit feature.
6. Open = first observed equity in the bucket; high = maximum observed equity; low = minimum; close = last observed equity. When aggregating saved daily OHLC, use the first daily open, maximum daily high, minimum daily low and last daily close; sum daily sample counts rather than counting rows as individual valuations. A single observation has O=H=L=C. Multiple identical valuations can also yield a doji. Do not substitute previous close for observed open.
7. Return = 100 * (bucket close / prior observed bucket close - 1). For the first bucket use the validated initial-capital baseline when available and positive; label inferred live capital consistently with existing reporting context. Otherwise return is unavailable. Nonpositive baseline also yields unavailable.
8. Returns are already percentage points, e.g. 0.34 means 0.34%, not 34%. Do not sum or average snapshot returns; aggregate equity and recompute bucket returns.
9. Missing buckets stay missing/whitespace. No forward-filled candles or made-up zero-return bars. When the previous observed bucket is separated by a gap, tooltip identifies that return spans the gap.
10. Last live bucket is provisional only while the execution is active and the bucket has not closed. Stopped/completed runs do not appear perpetually live.
11. Format very small nonzero returns with enough precision to show sign/value (up to six decimals, then scientific notation if necessary); normalize negative zero. Axis labels use compact currency ticks while tooltips show full values.
12. Preserve full precision for aggregation and only round for display. Test return computations with tolerances.

Example fixture: baseline 100, bucket A samples [100,110,95,105], bucket B [104,108,102,103]. A OHLC=100/110/95/105 and return=5%; B OHLC=104/108/102/103 and return approximately -1.904762%. B's open is 104 even though A closed at 105.

## 6. Preserve backtest OHLC before daily reduction

Recommended first delivery: extend the existing daily portfolio row with nullable fields `equity_open`, `equity_high`, `equity_low`, `equity_close`, and `equity_sample_count`. These are proposed additions, not existing columns.

- Generate a new migration during implementation; do not edit the shared reporting migration already in dev.
- Enforce all-or-none OHLC metadata, positive sample count, high >= max(open,close), low <= min(open,close), and high >= low when present.
- In BacktestExecutor, aggregate the full observed equity curve once before the current close-only resampling discards observations.
- Persist OHLC and sample count in the same existing daily upsert as total_value/cash/stock/daily_return. Require equity_close == total_value for those backtest rows.
- Preserve current final-point cash/stock values, existing daily_return calculation, row key, and metrics. No new per-bar SQL calls, no changes to fees, fills, signal evaluation, or trade timing.
- Cover all routes that finalize results, including manually stepped sessions. Warm-up observations must remain outside reported equity.
- Continue using SimBroker's typed arrays in the execution hot path. Aggregation happens at reporting/finalization; no additional object allocations per symbol tick.
- Re-running the same result write must be idempotent. A reporting retry must not strip already saved OHLC.

Deploy the additive migration before the writer and readers. Preserve existing portfolio ownership/run validation, RLS, and grants; do not add a client-writable reporting path.

### Legacy behavior

Older backtests with null OHLC stay readable in Line mode. Candle remains discoverable but disabled with: `Candle data is unavailable for this older backtest. Run it again to capture equity OHLC.`

Do not manufacture daily highs/lows from neighboring closes. If some dates are missing OHLC, report incomplete coverage and keep the Candle view unavailable for that run in v1. A later explicit close-sampled display can be designed separately.

Live history is different: existing timestamped snapshots can be aggregated into sampled candles immediately. No migration/backfill is needed to invent live intraperiod observations. If all usable live buckets are single-sample, show dojis with a sparse-data caption.

### Reviewed sparse-daily follow-up (PR #872)

The inspected 1d backtest contains 675 saved daily rows with equity_sample_count=1 throughout. Equal daily OHLC therefore reflects the stored observations, not a lost frontend aggregation. PR #872 adds calendar grouping to use those existing observations; it does not recover within-day valuation paths.

Source review checked Monday anchoring, UTC calendar months, sorted first/last observations, extrema/count reduction and close-to-close return recomputation. Read-only SQL aggregation of saved rows supplied reference weekly/monthly values consistent with those formulas. This was source/data inspection, not execution of the frontend adapter or browser validation. No tests or benchmarks were run, following the user's no-testing instruction.

No additional migration, historical backfill, market-data fetch, polling or trading change is required by this follow-up. Saved OHLC coverage remains mandatory for all backtest Candle intervals; older runs without OHLC stay unavailable. Genuine within-day ranges require intraday valuation observations.

## 7. Component and integration changes

| File | Work |
| --- | --- |
| `src/components/backtest/EquityCurveChart.tsx` | Card/selector wrapper, preference state, capability messaging, renderer selection |
| New `EquityLineChart.tsx` | Extract existing Recharts content without changing its data/visual semantics |
| New `EquityCandlestickChart.tsx` | Two-pane canvas lifecycle, candle and histogram series, crosshair, tooltip, range controls |
| New `equityChartTypes.ts` | Presentation contracts and run context |
| New `src/lib/equityChartData.ts` | Pure sanitation, UTC fixed/calendar bucketing, sparse-daily Auto choice, saved OHLC/count reduction, returns and formatting |
| `src/pages/BacktestResults.tsx` | Pass run id, mode/status, initial capital/context, OHLC capability; memoize view-model inputs |
| `src/hooks/useBacktestResults.ts` | Optional persisted OHLC typing; retain pagination and query scoping |
| `src/hooks/useLiveStrategyDetail.ts` | Retain selected source and normalized equity basis; expose explicit chart context if needed |
| `coreza-backend/src/backtest/BacktestExecutor.ts` | Aggregate and persist daily observed OHLC alongside existing closes |
| New backend reporting helper | Pure daily OHLC reduction with explicit UTC semantics |
| New migration + generated types as applicable | Nullable OHLC columns and validated constraints |
| Backend Jest and `tests/browser` | Aggregation, persistence, compatibility, and browser lifecycle tests |

Keep `LightweightVisualizeChart` and price/volume node rendering independent. Small reusable formatting/theme helpers are acceptable; a broad visualization refactor is outside this change.

Lifecycle requirements: create charts once per mounted Candle renderer, use ResizeObserver, disconnect observers/listeners/crosshair subscriptions and remove the chart on unmount, and handle Strict Mode mount cycles. Batch data replacement on a refresh initially; optimize the last bucket with series.update only after profiling. Do not refit on every refresh or crosshair movement.

## 8. Performance and refresh boundaries

- Preserve current paginated reads and scoped-loader stale-response guards.
- Build the candle model with memoization keyed to snapshots, selected run/source, interval, and baseline. Never aggregate on every pointer movement.
- One chart instance with native panes avoids separate-chart time-range synchronization loops.
- A selector change uses already loaded snapshots. It must not call the live metrics refresh endpoint.
- Test at least 100,000 input snapshots and 1,000 rendered buckets; target aggregation below 100ms and responsive pointer interaction on an agreed reference machine, recording actual measured hardware/results.
- Current loaders retrieve complete history. If profiling demonstrates unacceptable network or memory costs, add a separate scoped/range-paginated reporting aggregation endpoint in a follow-up before increasing supported retention. Do not quietly apply an arbitrary client row cap.
- No new websocket stream, polling schedule, or market subscription is required.

## 9. Ordered delivery and verification gates

### Phase 1 — pure contracts and fixtures

Implement the aggregation helpers and fixtures before canvas work. Establish stable bucket, source, baseline, precision, gap, and duplicate semantics. Confirm installed Lightweight Charts version supports the planned native pane APIs.

Gate: deterministic adapter tests pass; first/last close and derived return match hand-calculated fixtures.

### Phase 2 — durable backtest observations

Create and validate the additive migration locally, add daily OHLC persistence and optional types, and cover future-run versus legacy-run capability.

Gate: identical existing daily closes/returns and metrics before/after on a fixed backtest; observed OHLC survives save/reload; retry is idempotent. Verify schema readiness in the intended environment before enabling the writer.

### Phase 3 — selectable chart UI

Extract Line renderer, add selector/preference handling, implement Candle panes, tooltips, accessible summary, theme support, sparse/legacy states, and interval controls.

Gate: Line displays the explicitly amended metric/axis with correct labels; both backtest and live results behave correctly without additional data-fetch or execution side effects.

### Phase 4 — regression and staged enablement

Run focused backend tests and frontend browser tests, then relevant build/lint checks. Capture desktop/mobile and light/dark screenshots. Enable on dev after storage readiness and sample-run verification.

Gate: no run/source/currency leakage on navigation, no duplicate chart canvases/listeners, correct refreshed final candle, and responsive interactions at the stated data scale.

## 10. Test matrix

| Area | Cases and expected result |
| --- | --- |
| OHLC | Rising/falling/mixed/flat series; daily extrema preserved in weekly/monthly reduction; first daily open and last daily close; summed observation counts; all-single and mixed-sample Auto policies; dojis remain valid |
| Returns | First capital baseline, absent/inferred baseline, tiny positive/negative returns, zero/negative denominator; no double percent scaling |
| Time | UTC day/Monday/month boundaries, exactly-on-boundary sample, December/January rollover, leap February, date-only rows, DST/browser timezone changes, partial first/last periods and gaps |
| Data quality | Empty input, one snapshot, unsorted rows, duplicate timestamps, NaN/null equity, genuine zero, incomplete OHLC |
| Isolation | Different execution, workflow, broker, credential, base currency; never merge them |
| Persistence | Migration with legacy rows, OHLC constraint rejection, daily close equality, retry, ownership checks, unchanged metrics |
| UI | Selector keyboard interaction, stored preference validation, blocked storage, unavailable legacy Candle, mobile wrap, theme change |
| Canvas | Strict Mode/remount, resize, refresh while zoomed, hover in each pane, tooltip at gaps, leave chart, series toggling |
| Refresh | Same bucket changes OHLC, next bucket appends, finalized/stopped state clears provisional status, stale response ignored |
| Scale | 100k input points; bounded plotted buckets; all original observations retained by loader |

Use existing backend Jest configuration and Playwright `tests/browser` conventions. Suggested commands during implementation: focused `npm --prefix coreza-backend test -- --runInBand <test-name>`, `npm run test:browser -- <spec>`, `npm run build`, and `npm --prefix coreza-backend run build`. Run targeted lint on changed source paths and distinguish pre-existing failures from new failures.

This documentation-only commit does not claim these implementation tests have run.

## 11. Acceptance criteria

- [ ] Equity Curve offers Line and Candle in backtest and live results.
- [ ] Line shows closing equity above blue period-return bars using the same intervals and aggregation as Candle, with autoscaled equity and no cumulative-return overlay; persisted daily-return values remain unchanged.
- [ ] Candle shows observed portfolio-equity OHLC above aligned blue bucket returns, including weekly/monthly reduction of saved daily OHLC.
- [ ] Sparse daily backtests offer Auto/1D/1W/1M and clearly distinguish observed coarser ranges from unavailable intraday extrema; no invented candles or previous-close opens.
- [ ] OHLC tooltip, currency, return precision, crosshair, and time labels agree with the selected bucket.
- [ ] Future backtest OHLC survives reload; historical unavailable OHLC is clearly explained.
- [ ] Live candles use existing source-selected normalized valuations and disclose snapshot sampling.
- [ ] Empty, sparse, gap, provisional, and legacy states are handled explicitly.
- [ ] Choosing chart type does not alter trading, metrics, workflow documents, or data subscriptions.
- [ ] New storage is additive, scoped, validated, and deployed before dependent readers/writers.
- [ ] Focused tests, builds, visual review, and measured scale checks pass before rollout.

## 12. Scope and rollback

First release covers only the results-page Equity Curve. Defer security-price chart upgrades, exact QuantConnect branding, extra OHLC-bar chart types, deposits/withdrawal-adjusted performance redesign, session-calendar buckets, and a new reporting API unless profiling requires it.

Chart returns use the existing portfolio equity valuation basis; external cash movements can affect returns until explicit flow-adjusted reporting exists. Do not imply these bars are flow-adjusted performance.

Rollback the Candle entry/rendering to Line while retaining nullable OHLC fields and captured history. Keep old readers functional. No destructive migration or rewrite of historical reporting rows is required.
