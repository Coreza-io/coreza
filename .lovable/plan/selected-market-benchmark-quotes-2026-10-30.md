# Selected-market benchmark change rows

Implemented for dev review, 2026-10-30.

Rows show benchmark change amount and percent alongside the independent scheduled
session badge. User confirmed change amount. Default benchmarks: NASDAQ Composite
(^IXIC), NYSE Composite (^NYA), BSE SENSEX (^BSESN), NIFTY 50 (^NSEI), and BTC/USD.
Indices use points, not a dollar sign; BTC/USD uses USD. Details name the benchmark,
provider period and quote timestamp. The numbers are provider daily-reference
changes, not pre-market/overnight venue quotes. No invented return values.

An authenticated backend endpoint only accepts these allowlisted market IDs and
reads Yahoo Finance daily chart metadata. A one-day range ensures the chart close
reference is not a multi-day comparison. Success and unavailable results have a
60-second bounded per-symbol cache with in-flight deduplication and a six-second
provider timeout. The shared React Query cache polls once per minute while visible
and scopes requests by authenticated user and market selection. Quotes do not
change preferences, sessions, broker subscriptions or execution.

Deploy the backend route and frontend together. Yahoo availability/rate limits and
reporting delays can vary by symbol; failures display Quote unavailable and never
zero. Quote timestamps and the regular-session label are separate from scheduled
extended sessions. No paid data entitlement, account access or live venue accuracy
is implied. Actual provider payloads and browser behavior require deployment
verification; the authenticated endpoint was not exercised against a live account.

No automated tests added/run. TypeScript diagnostics are compared to baseline,
and a production frontend build is performed. No migration or new dependency.

## Source review follow-up

- Keep environment/logging initialization as the first backend import; route auth
  reads configuration at import time, so route imports must follow initialization.
- Use one reference-counted poller per QueryClient/user/market key. React Query
  shares cached requests but its observer interval option would create a timer
  for each dashboard/sidebar instance. Stop polling on last unsubscribe; skip
  hidden tabs and avoid cancelling an in-flight fetch during interval refresh.
- Require matching provider symbol and finite positive prices/reference values;
  exclude non-finite derived changes. Validate response count, unique requested
  markets, units, values and timestamps before rendering financial amounts.
- PR884 is merged. Its named sessions, assigned overnight dates, source metadata,
  coverage bounds and independent regular/ATS labels were reviewed again. No
  additional session-code change was required in this follow-up. Provider-policy
  re-verification and manual runtime/browser checks remain outstanding.
