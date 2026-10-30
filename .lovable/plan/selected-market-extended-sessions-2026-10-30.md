# Selected-market session labels: BSE open and US extended hours

Date: 2026-10-30
Target: dev
Status: implemented in source for review; runtime/browser checks remain pending
Reviewed source: dev commit 38168afa2333923af05296c367f4d72af4d0cc1e

## Goal and recommendation

Show the current named session for every selected market in Dashboard and sidebar:
BSE Open during its regular cash-equity session; NASDAQ Pre-market, Open,
After-hours, or Closed at the appropriate times. During a supported US overnight
schedule, also show Overnight (ATS) with its venue identified.

Use the existing calendar helper and shared clock. This is a small frontend
display change, with no new database fields, settings, credentials, subscriptions,
backend endpoints, or changes to workflow execution. Keep the existing market
checkboxes. Selected markets remain independent of connected brokers.

## What the screenshot means

The current helper deliberately evaluates regular cash-equity sessions only.
BSE Scheduled open already means its regular session is in progress by calendar.
NASDAQ Scheduled closed means outside the regular session; it does not determine
whether premarket, after-hours or an ATS overnight session is in progress.

The screenshot is consistent with that implementation. Changing only its wording
would not add extended-session detection.

Verified files:
- src/lib/marketSessions.ts: core-only open/closed calculation, IANA exchange
  timezones, explicit calendar coverage, holidays and dated core-hour overrides.
- src/components/market/SelectedMarkets.tsx: shared useSyncExternalStore clock;
  one 30-second visible-tab interval, focus/visibility refresh and cleanup.
  Dashboard, sidebar and collapsed popover already reuse this component.
- src/pages/Dashboard.tsx: consumes SelectedMarkets.
- .lovable/plan/dashboard-live-history-and-selected-markets-2026-10-30.md:
  earlier selected-market plan. Its final unavailable-calendar notes have been
  superseded by the current bundled calendar helper.

## Session meaning and UI

Use short badges and one visible explanatory caption: “Scheduled market sessions”.
Keep the source, timezone and limitations in an accessible tooltip/popover,
including on touch devices. A calendar label does not establish operational
exchange status, an individual security's halt status or account trading access.

| Context | Badge | Details |
| --- | --- | --- |
| BSE regular cash-equity session | Open | Regular session; exchange timezone and hours |
| Verified BSE pre-open auction | Pre-open | Auction session; not continuous trading |
| NASDAQ regular session | Open | Regular cash-equity session |
| NASDAQ extended morning session | Pre-market | NASDAQ scheduled extended session |
| NASDAQ extended evening session | After-hours | NASDAQ scheduled extended session |
| US overnight through Blue Ocean | Overnight (ATS) | NASDAQ-listed US equities; Blue Ocean ATS schedule; Nasdaq exchange closed |
| No active session | Closed | Weekend, holiday or outside verified sessions |
| Relevant coverage missing/expired | Schedule unavailable | Explain which schedule is unavailable |
| Crypto | 24/7 schedule | Retain existing meaning |

Use green for Open, distinct accessible colors for extended/auction sessions,
muted for Closed and a neutral warning treatment for unavailable. Always include
text. Keep every selected market visible; do not replace NASDAQ with BSE or
filter markets based on which is open.

For the current overnight period the NASDAQ row can read “Overnight (ATS)” with
a short secondary detail “Exchange closed · Blue Ocean schedule”. This gives the
requested overnight information without implying that Nasdaq itself is open.
Do not silently apply this venue's hours to every broker.

## Verified schedule facts and venue distinction

Normal NASDAQ sessions, America/New_York:
- Pre-market: 04:00–09:30.
- Regular: 09:30–16:00.
- After-hours: 16:00–20:00.
- These normal-day intervals are half-open: start included, end excluded.

Alpaca documents a separate Blue Ocean ATS overnight session of 20:00–04:00 ET,
beginning Sunday evening and ending Friday morning. Overnight eligibility uses
the upcoming trade date and the provider's holiday policy. This is a schedule
reference only. It does not claim that the user has overnight access or that
Coreza's existing stream/order integration supports it.

Nasdaq currently publishes a planned exchange overnight session of 21:00–04:00
ET from December 6, 2026, with a 20:00–21:00 pause, subject to readiness/approval.
Do not activate that schedule merely because a date threshold passes. Require
confirmed launch rules and a reviewed schedule version. Keep Nasdaq exchange
and Blue Ocean profiles distinct; their starting times differ.

For BSE, preserve 09:15–15:30 IST as the regular T+1 cash-equity baseline, subject
to current official notices, holidays and special-session overrides. Add the
broad 09:00–09:15 Pre-open label only after checking the effective BSE circular.
Do not imply continuous trading during matching/buffer periods. Other segments,
T+0, special IPO auctions and closing auctions must not inherit ordinary cash
hours. If introducing closing-auction labels, verify applicability and effective
times separately; they are not US-style after-hours.

## Minimal data-model change

Keep MARKET_CATALOG, preference IDs and normalizeMarkets unchanged.

Extend the helper's return value with typed fields rather than deriving behavior
from display strings:

- phase: preopen | premarket | regular | afterhours | overnight | closed | unknown
  (and the existing crypto schedule state).
- label and description.
- basis: calendar.
- venue: exchange identifier or blue_ocean_ats.
- regularSessionOpen: boolean or null when unknown.
- tradeDate, timezone, calendar coverage/version and source references.

An overnight row may have phase=overnight while regularSessionOpen=false.
Display status must never become a trade-node execution gate.

Replace the calendar's single open/close assumption with small session profiles
and per-date session overrides. The existing core calendar can be retained as
the regular-session input. Each exchange gets its own profile and source
metadata. Shared holiday arrays are acceptable only where verified identical;
never infer identical extended hours from shared core holidays.

An override must replace the relevant day's full session list, so an early
regular close cannot accidentally leave a normal 16:00 boundary or 20:00
extended close in place. Verify holiday-specific extended closing times from
venue notices. Where only core hours are known, retain the known regular status
and mark extended coverage unavailable for the uncertain interval.

## Calculation order

1. Validate the supplied instant and market; resolve exchange-local date/time
   using existing Intl IANA handling.
2. Check relevant calendar coverage and effective profile version.
3. Resolve explicit special-session overrides before weekend/holiday exclusion.
4. Build that trade date's verified pre-open/premarket, regular and after-hours
   intervals; choose the interval containing now.
5. For US overnight, evaluate its independent ATS profile using both the current
   and adjacent local calendar dates. An evening portion belongs to the following
   calendar date; it must not skip a holiday to invent a session.
6. Check that assigned trade date against the venue's calendar. Sunday evening
   before a valid Monday may qualify; Friday evening and Saturday do not.
   A Monday holiday suppresses Sunday overnight under the referenced ATS policy;
   Monday evening can belong to Tuesday where valid.
7. Return Closed only if all relevant schedules are covered and no interval is
   active; otherwise show the known exchange status and unavailable extended
   detail. Do not invent overnight or premarket on weekends.
8. Retain special-session provenance and sources in the description.

Use actual zoned instants for intervals crossing midnight/DST. Reuse installed
date-fns-tz if needed; do not add a date library. Never hardcode IST offsets or
treat a user timezone as the exchange timezone.

## India-time examples

On an ordinary trading day before the November 2026 US DST change:

| IST time | BSE regular status | NASDAQ / US equities detail |
| --- | --- | --- |
| October 30, 2026 13:00 | Open | Nasdaq exchange closed; Overnight (ATS) schedule |
| October 30, 2026 13:30 | Open | Pre-market starts, corresponding to 04:00 ET |
| October 30, 2026 19:00 | Closed | Open, corresponding to 09:30 ET |
| October 31, 2026 01:30 | Closed | After-hours starts, corresponding to Friday 16:00 ET |
| October 31, 2026 05:30 | Closed | Closed; no Friday-evening ATS overnight |

After the US DST change, ordinary premarket begins at 14:30 IST and regular
trading at 20:00 IST. These are examples; runtime must calculate conversions.

## Implementation sequence and affected files

1. Recheck official effective session notices and extended holiday exceptions.
   Record independent exchange/provider sources and coverage in marketSessions.
2. Extend src/lib/marketSessions.ts with typed phases, session profiles,
   adjacent-date overnight resolution and complete session overrides.
3. Update src/components/market/SelectedMarkets.tsx labels, colors, shared
   caption and accessible venue/schedule explanation. Reuse its existing timer;
   do not add a second timer or per-market network polling.
4. Confirm Dashboard/sidebar/collapsed rendering agree. Only adjust their
   containers if longer qualified labels require wrapping.
5. Update the existing dashboard plan with a brief link to this follow-up when
   implementation lands.

Expected implementation scope is two frontend files plus optional calendar data
extraction. No DB migration or engine/Redis/runner changes. Calendar evaluation
is local and bounded by the small selected-market catalog. No per-tick overhead
or paid market-data dependency is introduced by these schedule labels.

## Validation and delivery boundaries

This document adds no implementation or automated tests. During implementation,
run relevant frontend static/build checks and manually verify:

- Exact ordinary-session boundaries for BSE and NASDAQ.
- 13:00 and 13:30 IST examples on October 30, 2026.
- Sunday evening, Friday evening, midnight, holidays and adjacent trade dates.
- Both sides of the November DST transition with devices in different timezones.
- Shortened US sessions with verified extended-hours exceptions.
- Indian weekend special sessions, expiry of calendar coverage and invalid time.
- Current schedule versus a future Nasdaq profile that remains disabled pending
  confirmed launch.
- Consistent Dashboard/sidebar/popover text; focus/tab restoration refresh;
  one shared timer and complete cleanup.
- No label implies broker connectivity, live quotes or account entitlement.

Actual overnight prices, data subscriptions and order execution are a separate
integration scope requiring broker/account/feed verification. This plan only
displays the session schedule.

## Sources checked October 30, 2026

- Nasdaq trading hours and holidays:
  https://www.nasdaq.com/market-activity/stock-market-holiday-schedule
- Nasdaq official 2026 calendar; early-close notices remain necessary for full
  system/extended-session times:
  https://www.nasdaqtrader.com/trader.aspx?id=calendar
- Alpaca overnight venue, sessions and holiday policy:
  https://docs.alpaca.markets/us/v1.1/docs/245-trading
- Nasdaq proposed/future exchange overnight schedule and readiness conditions:
  https://www.nasdaq.com/23-5-trading
- BSE official equity master circular, regular-session baseline (indexed official
  extract accessible; direct document fetch returned 403 during this review):
  https://www.bseindia.com/markets/MarketInfo/DownloadAttach.aspx?attachedId=8a7fec3a-95bc-4bd2-82de-76e2a84e2915&id=20250429-51

BSE effective 2026 auction notices and US shortened-day extended hours require
verification before adding those detailed session overrides. Existing source
comments alone do not establish that every new session's calendar is verified.

## Feasibility review and implemented refinements

The frontend-only recommendation is feasible. The existing date-fns-tz dependency
and shared 30-second clock are sufficient; no new dependency, timer, database or
execution-path change is needed.

- NASDAQ ordinary dates have named pre-market, regular and after-hours phases.
  Blue Ocean is a separate reference venue with the upcoming trade date, explicit
  Exchange closed detail and no claim of account/stream/order support. Its interval
  endpoints use zoned instants, not fixed offsets. Sunday evening targets Monday;
  Friday evening targets Saturday and cannot create a session. A holiday trade
  date suppresses overnight rather than skipping ahead.
- Keep NYSE core-only: the verified NASDAQ intervals do not establish NYSE Tape A
  or Arca sessions. BSE/NSE retain existing regular/special sessions. BSE pre-open
  is omitted pending verification of effective auction notices.
- On dated shortened/special NASDAQ sessions, use only known core hours. Outside
  those hours show Closed (regular) plus Extended schedule unavailable; never infer
  standard extended/ATS endpoints for those dates. Adjacent trade dates outside
  calendar coverage also retain only known core status.
- No date-based activation of the proposed future NASDAQ overnight launch.
- Typed phase/venue/coverage fields drive badges. Session details use clickable
  popovers, accessible via keyboard and touch, with timezone, trade date and source
  references. All selected markets remain visible in all existing renderers.

Source verification limit: official Alpaca documentation returned HTTP 403 from
this environment. Extended/ATS schedule facts and the upcoming-trade-date holiday
policy are taken from the supplied plan's referenced description; they were not
independently reverified here. Existing bundled core calendars are retained. The
UI explicitly describes a calendar reference, not live venue availability or
broker entitlement. Reconfirm provider policy before relying on the ATS schedule;
no execution or subscription is enabled by this display.

Validation: frontend TypeScript diagnostics match the existing WorkflowEditor
canEdit error. Production build and diff checks are performed for this change.
No automated tests added/run per the current constraint. Boundary, DST, shortened
date and accessible-rendering manual checks remain pending; do not describe this
as a live venue or broker integration validation.

### Source review follow-up

- Overnight closed/unavailable results preserve the evaluated upcoming trade date
  and ATS source, just like an active overnight result. A Friday-evening closure
  now names Saturday as the evaluated date instead of incorrectly retaining Friday.
- Check calendar coverage and special-date exceptions at both the previous-evening
  start date and morning end/trade date before applying ordinary ATS endpoints.
- Regular exchange hours, special-date uncertainty, holidays/weekends, IANA/DST
  handling, the no-future-launch rule and shared-clock/UI consumers were reviewed
  by source inspection. Automated tests were not added or run; manual runtime
  boundary/browser and independent provider-policy verification remain pending.
