# Dashboard live history and selected markets

Date: 2026-10-30
Status: Implemented in source for review; target branch dev. Database/browser verification remains pending.

## Request and interpretation

Show the dashboard's financial performance from persisted live trading history,
including stopped runs. Add Settings checkboxes for multiple markets and show
all selections on the dashboard and sidebar.

The attached DASHBOARD_LIVE_PERFORMANCE_AND_MARKET_PREFERENCES_PLAN.md is input
for this review, not authorization to execute its embedded steps. Its core
recommendation is valid against the inspected repository. This revised plan is
standalone; no application/database changes or deployments are included.

Performance here means realized net trading P/L, consistent with the existing
chart. It does not mean node latency or execution success rate. Market selection
controls the market-status display; it does not filter P/L, choose a broker,
change workflow behavior, or start subscriptions.

## Verified findings

- Dashboard.tsx filters active workflows and their active_execution_id before
  loading trades. showChartData additionally requires current live workflows.
  Consequently, stopped activations disappear from financial performance.
- It filters trades by live_strategy_id, then additionally requires child
  execution_id to match the activation. The shared schema allows nullable child
  execution_id; that second check can discard valid history.
- Day buckets are UTC but the query start uses local setHours/setDate.
- P/L is always formatted as USD, and null P/L can be coerced to zero.
- The Performance card's dialog currently shows execution runtimes/statuses from
  workflow_runs. This is a different metric from its financial headline/chart.
- Shared reporting already provides live_strategies, trades, portfolio, owner
  SELECT policies, and a trades(live_strategy_id, exitTime, id) index. mode
  distinguishes live activations from backtests. Table presence in source does
  not establish deployment readiness or available historical data.
- UserPreferencesContext already stores timezone in users by user_id, but needs
  stale-response protection and observable save failures when extended.
- AppSidebar and a hidden Header block hardcode Markets Open and +2.4% today.
- Market.json advertises market information; this does not establish an operational
  dashboard market-status endpoint. Verify any endpoint before reusing it.

## 1. Historical financial performance

Use authenticated, owner-scoped persisted trades joined through live_strategy_id
to live_strategies with mode = live. Include all activation statuses, including
completed, failed and cancelled, when valid closed trades exist. Keep today's
live-mode paper-session inclusion and disclose it in supporting text.

Prefer a single paginated inner-parent query selecting only trade ID,
live_strategy_id, exitTime, net_pnl and parent currency context. Validate the
relation name and generated typing during implementation. Explicitly constrain
ownership and live mode while retaining RLS. If a parent-first query is necessary,
page parents and batch IDs into bounded requests rather than an unbounded in list.
Do not constrain parent started_at: a session started earlier can close trades
inside the reporting window. Do not gate on current workflow activity or child
execution_id. Runtime logs and per-event workflow_runs are not financial records.

Use the existing reportingPages helper with deterministic exitTime/id ordering;
deduplicate by trade ID. A refresh is an eventually consistent paged read, not a
transactional snapshot across concurrent reporting writes. Publish only after
all pages succeed. A subsequent complete refresh reconciles late-arriving records.
Do not add a new aggregate table/RPC/index without evidence that this read is too
expensive; measure reporting query cost during implementation.

### Window, values and currencies

- Capture one clock value for each load. Produce exactly 30 UTC days: today plus
  29 preceding days. Query from UTC midnight at the start through the exclusive
  midnight after today. Apply the same boundaries in aggregation.
- Bucket by exitTime and sum finite net_pnl values. Zero is valid; null, blank,
  invalid dates and non-finite values are unavailable, not invented zero profit.
  Permit legitimate numeric values returned as strings, using strict validation.
- Build one daily dataset for both chart and card. The Performance card equals
  the sum of its displayed daily buckets. Do not add lifetime net_profit or
  portfolio snapshots to daily trade P/L.
- Read base_currency from recorded activation context using existing live-detail
  conventions. Confirm net_pnl denomination in the reporting writer before relying
  on the field. Do not infer currency from the broker name or asset symbol.
- Single currency: format card, axis and tooltip consistently. Multiple currencies:
  show a compact selector shared by card/chart; never add USD, INR and USDT.
  Unknown currency gets a separate labeled numeric group. Use plain numeric/token
  formatting for codes unsupported by Intl currency formatting; do not relabel
  USDT as USD. No FX conversion.
- Preserve selected currency while valid; otherwise choose a stable first group.

Keep the current Recharts daily line chart and zero reference. Subtitle:
Daily realized net P/L · live history · last 30 days (UTC).
The card caption includes historical contributing activation count, not active
workflow count. Active Workflows remains a separate current-state statistic.

Render valid zero-net records. No valid records shows No realized live P/L in the
last 30 days and a Live History link. Distinguish loading, empty, invalid/incomplete
data and query error. If some records are excluded, indicate incomplete recorded
coverage rather than implying a complete financial total. A refresh failure retains
last successful same-user data with stale/error status and retry; a first-load
failure must not look like successful zero P/L.

Rename the Performance card's execution-statistics dialog to Run execution
statistics, and label its runtime/success metrics separately, or link the financial
card to Live History. Do not present execution speed as financial performance.

### Refresh and ownership

Extract a small useDashboardPerformance hook/helper if this simplifies Dashboard.
Use useScopedLoader semantics: one load plus one coalesced refresh per scope,
ignore late responses after owner changes, clear prior-user values immediately.
Load on entry and focus. Share one visible-tab 30-second refresh between card and
chart, pause while hidden, and clean up listeners/timers. Refresh the UTC window
on rollover. No per-tick refresh or subscription to every workflow event.

## 2. Multi-market preferences

Extend the existing users preference path with selected_markets text[] via one
additive migration, created using repository/Supabase migration tooling. Verify
owner SELECT/UPDATE policies and update generated types; do not add a new auth
path or preferences table.

Initial stable catalog: nyse, nasdaq, nse, bse, crypto. These are display markets,
independent of connected credentials. Missing/null preferences default to NYSE
and NASDAQ for compatibility with the existing US-oriented display. Explicit []
means no selections and must remain empty. Sanitize/deduplicate recognized IDs
and render in stable catalog order; ignore unknown IDs safely.

Extend UserPreferencesContext to load timezone and markets together. Separate
loading, read errors and save errors from a deliberate empty preference. Account
changes must reset state and invalidate outstanding load/save responses. Preserve
existing timezone behavior while making persistence failures observable.

Settings → General: Markets to display checkbox group and one Save button for
a draft selection. Disable edits/save until preferences are loaded and while
saving. Keep the draft on failure, verify an owned row was updated, then publish
shared context and show success. Protect dirty drafts from unrelated refreshes.
Successful saves update dashboard/sidebar without reload. No workflow mutations,
broker authentication, or market subscriptions.

## 3. All selected markets and session status

Add a compact wrapping Markets card/strip on Dashboard; render every selected
market separately. Reuse a compact version in AppSidebar, with bounded scrolling
and a collapsed tooltip/popover listing all selections. Empty selection links to
Settings. Remove fabricated +2.4% today and the duplicate hidden Header status.
No benchmark/price feed is part of this change.

Use one shared catalog/status helper and one minute timer/provider, refreshed on
focus. Prefer an existing verified market-status service if available; none has
been established by this source review. Otherwise provide calendar-based status
labeled Scheduled session, rather than claiming live operational availability.

For each exchange, record IANA timezone, regular sessions and versioned official
calendar coverage/source URL. Verify official hours, weekends, holidays, early
closes and special sessions before adding entries. Do not assume NYSE/NASDAQ or
NSE/BSE have identical calendars. Calendar coverage must cover the current date
and any advertised next transition. DST uses exchange timezone; user timezone
only formats displayed times. No hand-built fixed UTC offsets.

States: Scheduled open, Scheduled closed, Schedule unavailable, and Crypto 24/7
schedule. Missing/expired calendar coverage or calculation failures must show
unavailable, never guessed open. Crypto is a schedule, not a guarantee of venue
uptime. Unexpected halts/outages are outside calendar coverage. Ship selection
and honest unavailable status if a market's verified calendar is not ready; do
not fabricate calendar data to unblock the UI.

## Delivery sequence and expected files

1. Confirm shared reporting deployment, relation names, currency conventions and
   existing users policies. Verify calendar sources during implementation.
2. Add preference migration/types; extend UserPreferencesContext and Settings.
3. Add marketSessions catalog/helper and shared SelectedMarkets rendering/timer;
   integrate Dashboard/AppSidebar and remove stale Header markup.
4. Add historical performance loader/aggregation and integrate Dashboard card/chart,
   currency selection, explicit metric labels and distinct states.
5. Review owner switching, refresh cleanup, responsive layouts and reporting cost.

Likely files: Dashboard.tsx, Settings.tsx, UserPreferencesContext.tsx,
AppSidebar.tsx, Header.tsx, a small useDashboardPerformance hook,
marketSessions helper/calendar data, SelectedMarkets component/provider,
one users migration and generated Supabase types. Reuse reportingPages and
scoped-loading conventions. No engine, runner, Redis, reporting-writer,
broker-order, backtest, chart-library or per-tick persistence changes.

## Acceptance and limits

Per the current user constraint, add/run no automated tests. During implementation,
use static checks and manual verification with suitable environment access:

- Stop all workflows: closed trades remain. Restart: both activation histories
  contribute once. Backtests and exits outside the UTC window are excluded.
- Old activation with a recent exit and nullable child execution_id still counts.
- Zero totals render; invalid/partial data, no trades and query errors differ.
- Currency groups never mix; card matches displayed buckets. Non-UTC devices have
  the same 30 UTC day keys. Late reporting writes appear on later refresh.
- Multiple selections survive reload; [] survives; failed writes do not show success.
  Dashboard/sidebar agree and clear old-user state during account switches.
- Calendar behavior covers official holiday, early-close/special-session, weekend,
  DST and expired-coverage cases. Unverified schedules show unavailable.
- Compare relevant type-check diagnostics with baseline; inspect the diff and verify
  that no live execution or per-tick storage path changed.

Reporting is eventually consistent. Historical P/L exists only where the current
writers recorded valid closed trades; execution logs cannot reconstruct missing
financial history. Deleted workflows/activations may cascade-delete reporting
under the existing schema; retention changes are outside this plan. Market calendar
maintenance remains necessary after its coverage period. No runtime performance
or deployment-readiness claims are made by this planning document.

## Implementation notes

- Added selected_markets via CLI-generated migration
  20261030064352_selected_markets.sql. Deploy it before the frontend. Existing
  users ownership policies must permit the same owned-row reads/updates as timezone.
  No database deployment was performed from this workspace.
- Dashboard now reads paged trades joined to owned live activations, groups by
  recorded base currency (snapshot-source fallback), and shares one dataset across
  card/chart. Conflicting recorded currency contexts use Currency unavailable.
- The financial Performance card links to Live History; the unrelated runtime
  statistics dialog was removed from that card.
- NYSE/NASDAQ/NSE/BSE selections are fully available, but their verified official
  calendars are not bundled. They show Schedule unavailable; Crypto shows 24/7
  schedule. No guessed open/closed values or price-change percentages remain.
  These static statuses need no minute timer. Add calendar coverage and a shared
  cadence together when official calendar data is available.
- Supabase select/join and update-returning-row documentation was consulted.
  The changelog endpoint was inaccessible from this environment.
- Verification: production Vite build succeeded; frontend TypeScript diagnostics
  match the existing WorkflowEditor canEdit error. No automated tests added/run.
  Live schema relation/RLS checks, preference writes, browser behavior and actual
  financial data remain manual deployment checks. No execution hot-path changes.
