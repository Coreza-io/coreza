# Dashboard live performance and selected markets — minimal-change plan

Date: 2026-10-30  
Target branch: `dev`  
Status: Planning only; no application or database changes in this commit.

## 1. Requested outcome

1. The dashboard Performance Chart and Performance card must use persisted live-run history, including stopped/completed/failed/cancelled runs with recorded trades. They must continue showing the last 30 days of results when no workflow is currently active.
2. Settings → General gains a “Markets to display” checkbox group allowing multiple selections.
3. The dashboard shows every selected market with its own name and session status. The sidebar footer in the screenshot reflects the same selection instead of the fixed “Markets Open” label and “+2.4% today”.

Keep the existing dashboard layout, Recharts line chart, reporting writers, and workflow execution unchanged. Market selection controls market-status display only; it does not filter historical P/L or start subscriptions.

## 2. Findings verified on dev

| Location | Current behavior / implication |
| --- | --- |
| `src/pages/Dashboard.tsx` | Filters workflows by `is_active`, then `isBrokerPortfolioWorkflow`, builds a map from current `active_execution_id`, and queries only those sessions’ `trades`. Stopped sessions disappear. |
| Same file | Queries `live_strategy_id` but also checks each trade’s `execution_id` against the active execution map. The reporting schema guarantees live parent identity, while child execution_id is nullable; this extra gate can discard otherwise valid trades. |
| Same file | `showChartData` requires a current live-workflow count greater than zero. This incorrectly hides history even if there are historical trades. |
| Same file | Groups by UTC day but builds the start boundary using local `setHours`/`setDate`; the range and buckets can disagree. |
| `supabase/migrations/20261028000000_shared_strategy_reporting.sql` | Already creates `live_strategies` (both modes), `trades`, and `portfolio`, with owner policies and indexes. Live activation has `id = execution_id`; trades belong to the activation via `live_strategy_id`. |
| `src/pages/LiveStrategies.tsx`, `src/pages/Backtests.tsx`, `src/hooks/useLiveStrategies.ts` | Existing live history already reads `live_strategies` with `mode='live'`, including terminal runs. Reuse its source and scoped loading pattern. |
| `src/lib/reportingPages.ts` | Existing pagination helper is already used by dashboard trade loading and live history. Preserve complete pagination. |
| `src/contexts/UserPreferencesContext.tsx` | Already loads/saves timezone in `users`, keyed by `user_id`. Extend this existing preference path. |
| `src/pages/Settings.tsx` | Already uses that context for timezone; other local settings are not a reliable persistence pattern. |
| `src/components/layout/AppSidebar.tsx` | Footer status and +2.4% badge are hardcoded. |
| `src/components/layout/Header.tsx` | Contains a second hardcoded status/badge in a hidden section. Remove the stale duplicated market block or use the shared renderer if exposed later. |
| `src/nodes/Market.json` | Defines exchange choices and advertises `/market/market_info`, but the inspected backend `src/index.ts` does not mount a `/market` router. Do not assume this node supplies a working dashboard status API. |

Repository source establishes available structures, not whether the migration is deployed or how much historical data currently exists. Implementation must confirm the target environment has the shared reporting schema. Do not silently fall back to backtests or manufactured values.

## 3. Performance chart: smallest correct change

### Source and query

Keep the current metric: **daily realized net P/L**, not execution speed, success counts, account equity, or unrealized profit.

- Use authenticated, owner-scoped reads of `trades`, joined to `live_strategies` with `mode='live'`. Query trade exit timestamps in the selected window; do not restrict parent `started_at` to the window, because an older running session may close trades today.
- Prefer one paged trade query with an inner parent join. Include only needed fields: trade ID, live_strategy_id, workflow_id, exitTime, net_pnl and parent currency/context. Validate the actual PostgREST relation name against the deployed schema during implementation.
- If relation typing prevents the join, page owned live parent IDs first and query child trades in bounded ID batches. Never create an unbounded URL-length `in(...)` request.
- Explicitly filter ownership and live mode. Never aggregate all `trades` without discriminating the parent mode: the table also contains backtests.
- Remove active-workflow/current-execution filters from this reporting path. Use `live_strategy_id` as the durable membership key; do not require nullable child `execution_id`.
- Include all existing live-mode activations with recorded trades, regardless of current status. A failed run’s recorded realized trades still count. Retain the existing live-mode inclusion of paper sessions; explain this in the tooltip rather than introducing an unrelated environment filter.
- Persisted trade records are the financial source. Do not parse runtime logs or sum per-tick `workflow_runs`.

### Aggregation and rendering

1. Build exactly 30 UTC day keys: today and the preceding 29 days. Use a UTC midnight start and an exclusive next-UTC-midnight end for both the query and buckets.
2. For each valid trade, add finite `net_pnl` to the bucket for `exitTime`. Deduplicate by trade ID if loading batches. A stored zero is valid data; null, empty, or non-finite P/L is unavailable, not automatically zero.
3. Preserve the current daily line chart, zero reference line and compact labels. Empty days have zero realized P/L only within a successfully loaded dataset.
4. Determine visibility from valid historical P/L records, never from the active-workflow count or a non-zero total. A zero-net result must still render.
5. Use this same daily dataset to compute the Performance card’s 30-day sum. Do not sum lifetime `live_strategies.net_profit` or cumulative portfolio values into daily results.
6. Subtitle: “Daily realized net P/L · live run history · last 30 days (UTC)”. Card caption reports historical contributing runs, e.g. “Last 30 days · 3 live runs”. Active Workflows remains a separate current-state statistic.
7. No valid records: “No realized live P/L in the last 30 days”, with a link to Live History. Open positions or a newly started run alone do not create realized P/L.
8. Query failure: show an error/retry state, not a successful $0 result or “No data”. Retain the last successful result with a stale indication on refresh failure.

### Currency correctness

The current formatter always displays USD, while shared reporting includes `base_currency` and can include crypto.

- Resolve currency from the activation’s recorded base_currency, then its recorded snapshot-source context when present. Inspect live detail/reporting conventions before changing any normalization.
- For a single known currency, use that currency consistently in card, chart axis and tooltip.
- If multiple currencies occur, use a small currency selector for both card and chart; never add USD, INR and USDT into one dollar amount. Retain the last selection when valid; otherwise use a stable first available currency.
- Keep unknown-currency results in a separate “Currency unavailable” group with plain numeric values and explicit labeling; do not assume USD or silently hide them. No FX conversion service in this change.

### Refresh without tick-path changes

- Extract only this dashboard loader/aggregation into a small hook/helper if needed; do not reuse the entire live-list hook solely to load broad `select('*')` data.
- Load on dashboard entry and refresh on window focus. While the dashboard is visible, use one bounded 30-second refresh, shared with the card; pause while hidden and clean up on unmount.
- Reuse `useScopedLoader` semantics to prevent stale requests publishing after sign-out/account switch. Clear prior-user data immediately.
- Avoid new per-tick database writes, subscriptions to every workflow event, Redis calls, or worker changes.

## 4. Settings: multiple selected markets

### Preference storage

Extend `users` with one `selected_markets text[]` preference column through one additive migration. Reuse the existing owner-scoped users read/update path and policies; do not create a preferences table or new auth path.

- Stable IDs identify markets/exchanges, not broker credentials. Initial checkbox choices: NYSE, NASDAQ, NSE, BSE, and Crypto (24/7 schedule). This is a display catalog, independent of broker connection availability.
- Missing/null preference for an existing user defaults to NYSE + NASDAQ to preserve the current US-oriented starting experience. Explicit `[]` means no markets selected and remains empty.
- Validate, deduplicate and store only recognized IDs; use stable catalog order for rendering. Unknown stored IDs must not crash the UI.
- Extend `UserPreferencesContext` with `selectedMarkets` and `updateSelectedMarkets`. Load timezone and markets together. Reset both on user changes and ignore late responses from a previous user.
- Settings → General: add a compact “Markets to display” checkbox group below Regional Settings, with helper text “Choose the markets shown on your dashboard.”
- Use a Save button with a draft selection to persist multiple checkbox edits in one write. Disable saving while pending; confirm an owned row was actually updated, propagate errors, and toast success only after persistence succeeds.
- Saving updates shared context immediately after success, so the dashboard/sidebar reflect the choice without a browser reload. No broker authentication, workflow update, or subscription side effects.
- Update generated frontend database types for the additive preference column.

## 5. Market display and honest status

### UI

- Add a compact “Markets” card/strip on Dashboard using the same existing Card/Badge style. Render all selected markets in a wrapping layout; keep Recent Workflows and Performance Chart intact.
- Each item shows market name, session status, and optionally next open/close in the user’s display timezone.
- Replace the sidebar’s single hardcoded status with the same selected-market list in compact rows. Bound its height with scrolling when necessary; collapsed mode uses a tooltip/popover listing all selections.
- Use one shared market-status component/helper so dashboard and sidebar agree.
- Empty selection: dashboard shows “Choose markets in Settings”; sidebar offers the same link without a green “open” dot.
- Remove the fabricated “+2.4% today”. An index/benchmark performance feed and benchmark selection are outside this request.

### Minimum viable status source

Do not build a broker integration or market-data subscription solely for this UI. There is no verified working market-status endpoint to reuse in the inspected backend.

For this minimal implementation use a small **schedule/calendar-based status helper**, explicitly labeled “Scheduled session” in the card/tooltip:

- Maintain an allowlisted market catalog with exchange IANA timezone, regular session definition, and versioned official exchange calendar dates for the supported coverage period.
- Before coding the calendar entries, verify regular hours, weekends, holidays, early closes and special sessions against each exchange’s official published calendar. Record source URL and coverage year with each calendar. NSE and BSE are separate entries; NYSE and NASDAQ are separate entries.
- Compute sessions in the exchange timezone, with daylight-saving support. The user’s timezone changes displayed times only.
- Return a small shared result: market ID, scheduled state, next transition when known, calculation timestamp, calendar coverage, and source type.
- States: Scheduled open, Scheduled closed, Always scheduled (Crypto), and Schedule unavailable. Calendar coverage gaps or calculation errors must show unavailable, never a guessed green status.
- Crypto’s 24/7 label describes trading schedule, not exchange uptime or account connectivity. Scheduled status does not claim to detect outages, trading halts or unannounced closures.
- Recompute locally once per minute and when the tab regains focus. Use one shared timer/provider for both renderers.
- No quotes, return percentages, new polling backend, provider credentials or Redis work are required. If operational real-time exchange status is requested later, replace the helper’s data source without changing the selection model/UI.

This choice keeps the feature concrete and small while avoiding the misleading current “Markets Open” assertion. A weekday/hours-only check without a covered holiday/special-session calendar is not sufficient for a definitive schedule state.

## 6. Expected files

| File / area | Planned change |
| --- | --- |
| `src/pages/Dashboard.tsx` | Historical P/L loader integration, shared card/chart dataset, accurate empty/error states and Markets strip. |
| New small `src/hooks/useDashboardPerformance.ts` (if extraction improves clarity) | Scoped, paged historical trade loading; one bounded refresh; currency grouping and daily aggregation. |
| `src/contexts/UserPreferencesContext.tsx` | Persist/load selected markets alongside timezone; surface save errors and protect user switching. |
| `src/pages/Settings.tsx` | Market checkbox group and one save action. |
| New `src/lib/marketSessions.ts` and compact calendar data | Catalog, covered exchange calendars and pure schedule-state calculation. |
| New `src/components/market/SelectedMarkets.tsx` and shared hook/provider if needed | Reusable dashboard/sidebar market rows with one shared minute timer. |
| `src/components/layout/AppSidebar.tsx` | Replace hardcoded footer and fake return badge. |
| `src/components/layout/Header.tsx` | Remove only duplicate hidden hardcoded market status/return markup. |
| `supabase/migrations/` | One additive users preference migration, created with the repository’s migration tooling. |
| `src/integrations/supabase/types.ts` | Regenerate/update preference typing. |

No additional performance/history tables, reporting-writer changes, workflow engine changes, backtest changes, new chart library, market price feed or FX conversion.

## 7. Implementation order

1. Confirm target deployment has shared reporting tables and inspect existing users policies/type generation conventions.
2. Add selected_markets column and preference typing; extend the existing context and Settings.
3. Implement and source-verify the small market calendar helper; add shared selected-market display.
4. Switch dashboard P/L to owned historical live trades and correct UTC boundaries, currency formatting and chart/card gating.
5. Add scoped refresh/error handling; remove hardcoded footer/header values.
6. Review the final diff to ensure no changes enter the live execution or persistence hot path.

## 8. Focused acceptance checks

- A completed/stopped run with closed trades remains visible after all workflows stop.
- Restarting the same workflow retains results from both activation IDs without double counting.
- A run started before the 30-day window contributes trades closed inside it; old exits and backtests do not contribute.
- Nullable child execution_id does not suppress a valid live_strategy_id trade.
- Zero-P/L records render a chart; no records, invalid P/L and failed queries have distinct states.
- Card total equals the sum of displayed daily buckets for the selected currency; USD/INR/USDT are not summed together.
- UTC midnight and the exclusive window end behave correctly on non-UTC devices.
- Multiple checkboxes persist after reload; explicit empty selection stays empty; changing accounts does not expose previous selections or performance.
- Dashboard and sidebar show every selection, agree on schedule state, and handle collapsed/mobile layouts.
- Verified calendar dates cover weekend, holiday, early close/special session and DST cases. Missing calendar coverage shows unavailable.
- Confirm there are no new tick-path writes, market subscriptions, per-tick refreshes, Redis operations or fabricated percentage badges.

These checks belong to implementation. This commit creates the plan only and makes no runtime performance claim.
