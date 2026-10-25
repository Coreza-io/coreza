# Broker fill accounting rollout

The new broker order path is disabled unless `BROKER_FILL_ACCOUNTING_ENABLED=true`.
Deploy the migration before the backend/FillSyncWorker changes. Do not enable the
flag until fixture replay and paper trading have been completed. No tests, builds,
type checks, database queries or migrations were run for this implementation PR,
at the request of the author. The Supabase CLI was unavailable; the migration is
provided for review and deployment through the normal migration workflow.

## Controlled baseline

Pause affected ingestion, retain pending source messages, and reconcile broker
executions, cash, fees, positions, order totals and partially aggregated closing
trades. A position snapshot alone is insufficient. Keep one workflow owner for
each user/broker/stable account/environment scope. Account ID must survive
credential rotation; credential ID and execution/run ID are attribution only.

Use `OrderFillApplicationService.establishBaseline(params, context, baseline)`
from the trusted backend deployment/reconciliation process. It is deliberately
not an HTTP endpoint or an automatic live-start action. Supply:

- `params`: `broker`, `brokerAccountId`, and `environment` matching the workflow.
- `context`: the owning `userId` and `workflowId`.
- `baseline.state`: the complete reconciled `PortfolioManager.exportRecoveryState()`
  format, including pending closing trades, entry identities, fee balances and
  the trade counter. Never supply a freshly empty manager for an existing account.
- `baseline.checkpoints`: an entry for every existing order, with decimal-string
  `quantity` and `notional`, explicit `cumulative` and `priceMode`, `symbol`, `side`,
  accepted lifecycle `status` and known source freshness.
- `baseline.sourceBoundary`: the ISO broker event-time boundary at which the
  authoritative state was established. Already covered fills must remain before
  this boundary. Reconcile ambiguous execution timing before resuming.

The method validates workflow ownership and refuses to replace an existing
baseline. There is no automatic ownership takeover, historical repair or baseline
replacement. Subsequent recovery reads the complete committed state before
normalizing each event. A restart does not start a partly filled order at zero.
Run Create Portfolio to recover state before querying a restarted runner. Register
new zero-fill orders through Register Order before accepting their first fill;
automatic broker order registration remains a separate feature.

Balance/position reconciliation while this path is active is intentionally
blocked. Pause ingestion and use a separately reviewed reconciliation action;
never race an absolute broker snapshot against accepted accounting.

## Mappings

New nodes persist `cumulativeFilledQty=true`, `fillPriceMode=cumulative_average`.
Older nodes missing the fields retain `false` / `execution`, including import and
copy. These compatibility defaults do not repair older incorrect mappings.

| Source | Quantity / price mapping |
| --- | --- |
| Alpaca | `filledQty` / `filledAvgPrice`: cumulative / cumulative_average; `lastFilledQty` / `lastFillPrice`: incremental / execution |
| Binance Spot | `filledQty` / `filledAvgPrice`: cumulative / cumulative_average; map `cumulativeQuoteNotional` for exact quote notional; `lastFilledQty` / `lastFillPrice`: incremental / execution |
| Binance Futures | Existing `filledQty` is incremental; pair it with `lastFilledPrice` or additive `lastFillPrice` for execution price. Checked mode maps `cumulativeFilledQty`. `filledAvgPrice` is cumulative_average and requires cumulative progress. |
| Schwab | Map separate `cumulativeFilledQty` / `cumulativeAvgPrice` or `lastFilledQty` / `lastFillPrice`. The legacy fallbacks change meaning between events and require mapping review. |
| Dhan | `TradedQty` semantics remain unverified. Separate average/execution prices are exposed. `ExchOrderNo` is exposed as `brokerOrderReference`; it is no longer claimed as a unique execution ID. Reconcile against verified broker trades before enabling. |

Map Source Event Time from the broker, stable Broker Account ID, environment and
credential attribution on order updates. Map Last Execution Quantity to prove
that the event covers the increase and its per-event fee. Complete Execution and
Fee Coverage is an explicit source guarantee, not a broker-name heuristic. Do
not select it to bypass missing execution history. Cumulative catch-up with
unknown historical fees requires reconciliation.

Incremental quantity with cumulative VWAP needs mapped Cumulative Order Quantity
or a proven complete event history. Quantity mode never selects price mode.
For cumulative 0.3 at 100 followed by 0.5 at 104, the accepted second execution
is 0.2 with notional 22 and price 110.

## Acceptance and recovery

Normalization uses exact decimal quantity/notional/fee comparisons. Existing
portfolio/UI projections retain their numeric APIs. There is no arbitrary
rounding or negative correction fill. Invalid price, changed interpretation,
inconsistent cumulative totals/notional, late executions needing chronological
replay, fills after a terminal state and ambiguous position snapshots return
`reconciliation_required` without claiming the execution or advancing progress.
Non-quote fees require controlled reconciliation of asset valuation and position
cost basis; this initial path refuses to treat their raw asset amount as quote
currency commission. Separately identified late fee adjustments and broker
corrections also require that controlled reconciliation path.

The SQL transaction locks the portfolio row and checks its workflow owner and
version, claims a scoped receipt, commits normalized execution/checkpoint and
complete recovery state, writes live fills and stable-key closed trades, and
enqueues publication. A competing worker rehydrates and re-normalizes against
the winning version. Trade matching uses the position before the accepted fill.
Duplicate financial executions may still advance valid terminal lifecycle and
finalize partial closing trades with zero new quantity.

RAM is published after commit. Losing the response or crashing after commit
recovers the committed state on retry. Financial sinks already belong to the
SQL transaction; Redis publication is a projection. The outbox retries with
deterministic fill IDs; FillSyncWorker reclaims pending messages and acknowledges
only after a successful SQL upsert. It preserves broker execution identity and
keeps algo lifecycle coalescing separate from ordinary fills. Streams no longer
trim potentially unprocessed entries. Establish a consumer-aware retention
policy before purging acknowledged history; never purge the SQL recovery state
or ledger as a stream-retention substitute.

On rollback, pause ingestion and retain the SQL ledger, receipts, checkpoints,
recovery state and outbox. Do not pass accepted executions back through the legacy
path. Historical incorrect accounting needs a separately reviewed rebuild.
