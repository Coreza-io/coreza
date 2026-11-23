# Backtest bar execution history

## Expected behavior

- When capture is enabled, give every processed strategy bar its own row in **Workflow Editor → Executions**, just as a delivered event gets its own row in live mode. Include bars that finish without placing an order and bars where a condition skips all downstream actions.
- Show the symbol, historical bar time, and execution status on each bar row. Keep the existing backtest run row for the overall status and results.
- Let users filter bar rows by symbol and historical time range, and open any row in the existing read-only execution graph. Show the bar's `OnBar` payload, each executed node's output, available timing and errors, and the upstream-output view used by live history.
- Default per-bar capture to disabled. An operator can enable it for saved, database-backed batch backtests through the backend environment. Editor-only sessions and warmup replay stay out of per-bar history.

With capture enabled, if a backtest processes 100,000 symbol bars and submits 12 orders, it creates 100,000 bar rows plus the existing backtest summary. If AAPL and MSFT both have a bar at 10:00, they get two independently selectable rows.

## Current code on `dev`

| Area | Current behavior |
| --- | --- |
| Live capture | [WorkflowRunner](../../coreza-backend/src/services/WorkflowRunner.ts) creates a Redis run for each delivered event. [RunSyncService](../../coreza-backend/src/workers/RunSyncService.ts) syncs terminal runs to `workflow_runs`. |
| Backtest entry | [WorkflowLifecycleService](../../coreza-backend/src/workflow/WorkflowLifecycleService.ts) creates a parent run with the graph snapshot. [JobQueueManager](../../coreza-backend/src/infra/jobQueue/jobQueueManager.ts) starts the database-backed session with that run ID. |
| Backtest processing | [BacktestSession](../../coreza-backend/src/backtest/session/BacktestSession.ts) processes aligned timestamps, invokes the strategy for each symbol with a bar, and uses either the compiled VM or the dynamic runtime. [BacktestExecutor](../../coreza-backend/src/backtest/BacktestExecutor.ts) returns the latest node snapshots to the parent run. |
| History UI | [useExecutionHistory](../../src/hooks/useExecutionHistory.ts) queries run summaries and loads the selected detail separately. [ExecutionDetailView](../../src/components/workflow/ExecutionDetailView.tsx) renders the snapshot. [InputPanel](../../src/utils/InputPanel.tsx) shows the selected upstream node's recorded output. |

## 1. Configure capture through the backend environment

Document the flag in `coreza-backend/.env.example` alongside `BACKTEST_EXECUTION_MODE`.

```dotenv
BACKTEST_EXECUTION_HISTORY_ENABLED=false
```

| Value | Behavior for new backtests |
| --- | --- |
| Unset or `false` | Keep the existing backtest summary and final node results. Skip per-bar capture, serialization, buffering, and writes. |
| `true` | Capture every processed strategy bar for saved, database-backed batch backtests. |

Only the literal value `true` enables capture. Set the flag on the backend process that runs backtests and restart it to apply a change. Resolve the setting once when the session starts and use the same value throughout the run, independently of the compiled or dynamic execution mode. Previously recorded bar rows remain visible and searchable after disabling capture.

## 2. Store a child run for each bar

Extend `workflow_runs` so the existing history query and detail selection can serve both live and backtest rows.

| Field | Bar row value |
| --- | --- |
| `id`, `workflow_id`, `initiated_by` | Bar run UUID, workflow ID and owner from the parent run |
| `parent_run_id` | Existing saved backtest run ID |
| `bar_sequence` | Monotonic sequence within the parent, including separate invocations at a shared timestamp |
| `bar_index`, `bar_symbol`, `bar_time` | Aligned event index, canonical symbol and historical market timestamp |
| `started_at`, `completed_at`, `status` | Actual processing times and terminal execution status |
| `result`, `error_message` | Live-compatible node results, execution order, per-bar timing and available error information |
| Graph snapshot | Read the parent run's nodes, edges and clusters when opening the bar |

Use a unique key on `(parent_run_id, bar_sequence)` for idempotent batch retries. Enforce parent and child workflow ownership consistency in the database and cascade child deletion with the parent. Keep child references under the existing workflow-run read policy and service-role write permissions. Use nullable bar fields for existing run types. Index by workflow and historical time, with a symbol-first index for combined symbol and time filters. Add the migration, installer schema changes, and Supabase types together.

Audit run recovery, cancellation, reporting and any existing consumers that assume one row per backtest. Scope parent-only operations to parent rows and exclude bar children from realtime workload where the history UI can refresh in batches.

Keep the runner's strategy and execution context tied to the existing backtest ID and parent run. Child IDs are for history only, so they cannot split indicator state, variable state, or simulated positions between bars.

## 3. Capture the result of each strategy invocation

1. Pass the saved parent run ID from `BacktestExecutor` to the batch session. Create the history writer only when the environment flag is enabled, persistence is set to database, and a saved parent run exists. With capture disabled, use the existing execution path without installing capture hooks.
2. Start capture around each symbol's strategy invocation in `BacktestSession`, after confirming that symbol has a bar. Keep SimBroker's existing timestamp processing order and leave the workflow's decisions and fills unchanged.
3. In the dynamic engine, take the current invocation's execution order and node results after execution. Project results to nodes that ran on this bar and capture per-bar timing separately from session totals. Include partial results if a downstream node fails.
4. In the compiled VM, observe instructions as they complete and capture their outputs and timing. Only record instructions reached on the current bar. The VM reuses output slots, and the backtest executor reuses mutable `OnBar` result objects. Snapshot recorded values before reuse, including earlier nodes' outputs if a later invocation can overwrite them.
5. Use the existing workflow result serializer and historical node-result shape. Preserve the live view's latest output per node within a single event, even when a Loop invokes a node repeatedly. The Input panel continues to show recorded upstream output. A raw executor-input trace is outside this plan.
6. Record a successful bar even when no order was submitted. Record a failed bar with the available partial results and error before propagating the strategy failure. If an in-flight bar is cancelled, preserve its available results with cancelled status. Bars the strategy never started have no row.

## 4. Persist with bounded batches

- Use a per-backtest buffer and batch-upsert completed bar rows. Bound it by both row count and encoded payload bytes, and apply backpressure if the writer falls behind. Keep Redis and Supabase network calls out of the individual bar path. The live ingestion path has a capped Redis pending list, so the backtest writer needs its own bounded buffer to preserve every processed bar.
- Retry transient writes with the same parent and sequence keys. Flush the final batch on success, failure, and cancellation before the parent run becomes terminal. If retries are exhausted, report the history persistence failure on the parent and keep any rows already committed available for inspection. Only report complete history after all processed rows are persisted.
- Batch storage writes and coalesce history refreshes. Keep summary queries free of node payloads and graph JSON. Store each workflow graph once on the parent. Measure payload size as well as row count, since a node can return a rolling window on every bar.

## 5. Add filters and reuse the execution detail view

- Extend `useExecutionHistory` and `ExecutionHistoryPanel` to display symbol and bar time for bar rows. Add exact symbol and time-range filters for historical bars. Use the configured display timezone for the filter and convert to UTC for the query.
- Preserve the existing execution-start filter for wall-clock run time. Historical bar time and execution start are separate fields. When filtering bars, use a stable cursor on `(bar_time, id)` so multiple symbols at the same timestamp paginate correctly. Use the existing execution-start cursor for the general list.
- On selection, load the bar result and its parent's saved graph by ID. Render through `ExecutionDetailView` with the bar's status, elapsed time and recorded node results. Show the historical bar timestamp explicitly in the header. Bind the selected detail and its graph to the same request so fast selection changes cannot mix two bars.
- Keep pagination and filter changes server-side. On older histories, existing rows continue to open normally.

## 6. Verify before merge

| Scenario | Acceptance check |
| --- | --- |
| Flag defaults and opt-in | Unset, `false`, and unexpected values produce zero new bar rows and preserve existing backtest summary and results. Explicit `true` enables capture in both engines. Turning it off leaves previously captured history readable. |
| No orders or an unselected branch | Every processed symbol bar appears. Selecting one shows its `OnBar` output and the correct branch results. |
| Multi-symbol data with missing bars | An aligned timestamp can produce multiple rows. A symbol with no bar at that timestamp produces no row. |
| Compiled and dynamic execution | Both produce the same bar identities and node outputs for the same strategy, allowing timing differences. An alternating branch cannot inherit an output from the previous bar. |
| Warmup and editor memory sessions | Warmup data can affect indicators and strategy state. Neither entry point creates persisted bar rows. |
| Failed or cancelled run | Rows for work already processed can be opened. A retry of the same write batch creates no duplicates. |
| Symbol and historical time filtering | Combined filters, equal timestamps on page boundaries, timezone conversion and switching selection return the intended rows. |
| Saved graph and ownership | Editing the workflow after the run does not change its history graph. Another workflow owner cannot read or write its bar rows. |
| 100,000 processed bars | Verify 100,000 child rows and compare wall time, bar throughput, peak memory, write volume and history query latency against the same run before capture. Confirm that storage batching leaves the trade and equity outputs identical. |

Apply the migration before setting `BACKTEST_EXECUTION_HISTORY_ENABLED=true`. Schema changes are additive so the previous application version can still open existing runs during rollback.
