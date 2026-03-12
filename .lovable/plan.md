

# Fix: entryTime/exitTime undefined in backtest trades

## Root Cause

The `backtest_trades` table already has `entryTime` and `exitTime` columns, and SimBroker correctly populates them from `bar.timestamp`. The problem is upstream:

**In `BacktestExecutor.ts` line 570-574**, the BacktestTrade executor parses `current_bar` with raw `JSON.parse` instead of using `parseBar()`:

```ts
// BROKEN — raw parse keeps { time: 1234567890, open, high, ... }
currentBar = typeof params.current_bar === "string"
  ? JSON.parse(params.current_bar)
  : params.current_bar;
```

The broker data format has `time: number` (Unix ms), but SimBroker expects `timestamp: string` (ISO 8601). The `parseBar()` utility at `coreza-backend/src/utils/barParser.ts:34` does this conversion:

```ts
timestamp: new Date(data.time).toISOString()
```

The Portfolio executor at line 894 already uses `parseBar()` correctly. The BacktestTrade executor does not.

## Fix

**File: `coreza-backend/src/nodes/executors/BacktestExecutor.ts` (lines 568-577)**

Replace the raw JSON.parse block with the existing `parseBar` utility:

```ts
const currentBar = this.parseBar(params.current_bar);
```

This single-line change ensures `bar.timestamp` is a valid ISO string, which flows into `applyFill → currentEntryMap.set(filledAt: timestamp)` for entry time and `exitTime: timestamp` for exit time.

No schema changes, no new columns, no frontend changes needed — the data pipeline and UI already handle these fields correctly.

