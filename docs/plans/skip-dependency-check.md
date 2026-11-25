# Skip Dependency Check in Execution History and backtests

## Goal

Show the saved `Skip Dependency Check` setting on a node in Execution History, including nodes inside clusters. Honor the setting during historical backtests by using the existing dynamic engine when the workflow needs it.

## Minimal changes

1. **Use the run's edges in Execution History.** In [BaseNode.tsx](../../src/components/nodes/BaseNode.tsx), compute the incoming edge count from `data.historyEdges ?? []` in read-only mode and from `canonicalGraph.edges` in the editor. Use the canonical node ID in both views. Reuse the source selection already used for previous-node lookup. The history view already hydrates the saved setting and passes the original snapshot edges to the node. Keep the existing two-incoming-edge threshold and disabled history switch. Older runs with no stored topology fall back to an empty edge list.
2. **Use the dynamic engine for backtests that enable the setting.** In [compiler.ts](../../coreza-backend/src/backtest/compiled/compiler.ts), add a compile eligibility guard beside the existing Continue on Error guard. Return `null` when any strategy node has a truthy `values.checkDependency`, matching the dynamic engine's check. [BacktestSession](../../coreza-backend/src/backtest/session/BacktestSession.ts) already handles a null plan by using the dynamic engine. This preserves queue ordering and input delivery for opted-in joins. A lower activation count alone would still leave the compiled VM's fixed topological order and input selection in place. Backtests that enable the setting can run more slowly on the dynamic engine. Other workflows retain their current compilation eligibility.

## Scope

The two changes use the existing node setting, history snapshots, and backtest fallback. The BacktestInit warm-up already uses the dynamic engine. The reported `Both values must be numbers` warm-up failure needs the failing Compute node and its resolved operands to diagnose, so it is outside this fix.

Testing is outside this plan.
