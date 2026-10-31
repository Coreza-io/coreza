# Portfolio accounting v2: staged implementation

This change implements the calculation foundation and durable acceptance path of
`portfolio-calculation-correctness-and-recovery-2026-10-31.md`. It does not complete
the plan's deployment acceptance criteria. No tests, broker calls, migrations,
workflow migrations, or historical corrections were run as part of this change.

## Implemented

- Explicit, configuration-only calculation/quantity/price/fee modes. Missing
  calculation version keeps legacy incremental behavior. The native numeric
  `cumulativeFilledQty` field cannot overwrite the checkbox.
- Bounded decimal arithmetic, cumulative quantity/notional deltas (including
  cumulative VWAP), exact held quantities, proportional open cost and entry-fee
  allocation, residual allocation on final close, and immediate partial-exit P&L.
- A pure candidate reducer, followed by awaited SQL journal/checkpoint acceptance
  under one owner token and expected revision, followed by complete RAM publication.
- Durable scoped execution identities, immutable financial-payload conflicts,
  independent lifecycle updates, and an idempotent reporting outbox. Journal payloads
  retain original event timestamps and decimal strings. Reporting uses the existing
  `live_fills`, `live_strategies`, `trades`, and `portfolio` contracts.
- Rejected broker facts are retained separately when SQL is available; unsupported
  shorts, futures/margin, non-quote fees, fee-only corrections, corporate actions,
  unexpected positions, and negative allocated cash stop the session.
- Exclusive account admission across activations/workflows in SQL; account-wide
  quantities are comparisons and cannot overwrite workflow attribution.
- Pending Redis fill reclaim with cursor continuation, independent consumer names,
  stream-scoped retry counters, conflict detection, and retained DLQ evidence.
- Shared final-close fee allocation in live calculations and SimBroker; fractional
  simulated position changes use decimal addition. Position/trade getters return
  copies, reads no longer create a starting-equity baseline, and MTM refreshes total P&L.
- Account/activation-scoped UI order grouping and separate commission-asset totals.
- A pure shadow/replay helper that does not execute trading nodes.

## Deployment gate

`PORTFOLIO_ACCOUNTING_V2_ENABLED` defaults to disabled. Keep it disabled until the
remaining gates below have been implemented and verified. Existing legacy workflows
are not silently migrated or claimed to have durable accounting guarantees.

`coreza-backend/sql/portfolio_accounting_v2.sql` is deployment source, not an applied
migration. The environment lacked the Supabase CLI and network proxy needed to
generate a migration. Inventory the deployed schema (including reporting UUIDs,
credential columns, existing grants, account identities, and numeric ranges), generate
and review an additive migration using the CLI, deploy readers/schema before writers,
and verify service-only privileges/RLS. No database changes have been executed.

New version-2 allocations require explicit cash, currency, activation, broker,
environment, stable non-secret account identity, credential alias, and exclusive
long-only cash/spot model. They cannot adopt existing account holdings or switch an
active legacy book. Decimal strings must be mapped from native payload evidence;
converting a broker decimal to Number upstream cannot restore its original precision.

Incremental executions require stable broker execution IDs. Cumulative IDs are safe
only when the provider guarantees a cumulative progression and the checkpoint's
baseline is known. Map `quoteNotional` consistently with the selected quantity mode.
Select cumulative VWAP independently of quantity and fee semantics. Original broker
ISO timestamps or numeric epoch milliseconds are required.

A restart cannot silently take ownership. The old owner token, exact checkpoint,
accepted journal, and retained failures remain intact. Broker-history completeness,
missing fills, open orders, cash/position discrepancies, attribution and source cursor
boundaries must be verified before an explicit recovery/handover. Never resubmit
orders or replay trading nodes to recover accounting. The replay helper expects only
events strictly beyond the supplied checkpoint; SQL journal identities remain the
authority for overlap with older events.

## Remaining gates before activation

1. Implement provider-specific snapshot/history reconciliation and approved ownership
   transfer. Persist verified provider boundaries, restore peak/valuation metadata,
   validate instrument precision/mark age, and compare account truth separately from
   allocations. Automatic restart/reconnect recovery is deliberately blocked.
2. Implement account reservation/settlement authority and submission guards. Version-2
   broker submissions, `get_cash` sizing and legacy mutation/reconciliation/cancel adapters are blocked;
   futures, shared accounts, non-quote fees/FX, and unsupported adjustments are blocked.
3. Wire native exact-decimal and source cursor/generation mappings for each supported
   broker. Verify upstream stream retention/pending recovery; reporting-stream reclaim
   alone cannot recover broker executions lost upstream.
4. Run the plan's P01–P06, idempotency, invariant, isolation, crash/restart and reporting
   acceptance matrix. The user requested no testing for this PR, so none was added/run.
5. Shadow verified broker evidence, validate paper accounts through reconnects and
   partial fills, pause/reconcile old activations, explicitly migrate mappings, then
   stage live activation. Do not enable based solely on arithmetic review.

After verified schema deployment, `PORTFOLIO_ACCOUNTING_V2_STORAGE_READY=true` allows
the reporting outbox to drain independently of new-writer activation.

Rollback disables new starts and keeps journals/checkpoints/outbox/failure evidence.
Do not let a legacy runtime start a migrated activation or reinterpret its quantities.
Account exclusivity is released only through a separately reviewed reconciled handover.
Historical repair remains a separate explicitly authorized task.
