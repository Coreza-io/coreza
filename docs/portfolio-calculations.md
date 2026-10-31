# Portfolio calculations

The Portfolio node applies fill accounting in memory by default. It adds no database
reads, database writes or network waits to financial acceptance. Existing ownership
lookups and asynchronous reporting continue through their existing paths. No new
schema, session layer, journal, outbox or feature flag is required.

Filled Quantity means one execution unless Cumulative Filled Quantity is checked.
The checkbox comes from node configuration; a numeric native stream field cannot
replace it. Price Meaning and Fee Meaning are independent settings. Cumulative order
average prices are converted using cumulative notional differences, not multiplied
by the latest quantity delta. Changing interpretation for an active order is rejected.

Only the affected order, position, cash balance and fee/profit totals are calculated.
The complete candidate is validated before these records are published synchronously.
There are no full-book deep copies, checkpoint serialization or per-fill mutex waits.
Existing portfolio valuation is read once to derive the updated equity and peak.

Stable execution IDs (or supplied sequences) protect the complete financial update
against duplicate delivery within the activation. Conflicting identities are rejected.
Status-only messages cannot consume future execution identities. Sources without a
stable ID/sequence must provide cumulative progress to identify repeated totals;
identical legitimate incremental fills cannot be distinguished from replays otherwise.
Execution identity coverage is bounded without silently expiring accepted identities.

Cost basis, remaining entry fees and cash accumulation use pinned decimal arithmetic.
A final close allocates all remaining basis and entry fees. Partial exits update
realized accounting immediately; closed-trade reporting retains order-based grouping
and is submitted asynchronously when the order becomes terminal. Partial-exit net
profit is visible before that reporting group is finalized. SimBroker shares the fee
allocation helper and rolls back failed financial calculations.

This financial treatment supports long-only cash/spot positions with quote-currency
fees, including per-execution rebates. Unexpected shorts, cross-account position
mixing, mismatched broker positions, non-quote fees, cross-currency valuation and
futures/margin instrument models require explicit accounting treatments rather than
spot-based estimates. Broker order APIs and existing buying-power policies are unchanged.

State and duplicate coverage last for the in-memory activation; persistence/restart
reconstruction is outside this change. Existing reporting storage is retained.

Performance review is source-only: decimal arithmetic has CPU cost, but this change
removes the proposed database waits, full-state cloning and additional worker polling.
It does not establish an unchanged wall-clock execution time without measurement.
No tests, builds, lint, benchmarks, broker calls or database migrations were run.
