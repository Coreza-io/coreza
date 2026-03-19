

# Plan: Stop Timestamp Manipulation — Use Broker's Native Epoch

## Root Cause

The broker `Bar` type already provides `time: number` (epoch ms). The bug is in `alignMultiSymbolBars()` which unnecessarily converts it to a string via `String(bar.timestamp ?? bar.time)`, producing `"1699228200000"`. Later, `BarBuffer.toEpochMs()` calls `Date.parse("1699228200000")` which returns `NaN`.

The fix is simple: **stop converting to strings. Use the numeric epoch the broker already sends.**

## Changes

### 1. `alignMultiSymbolBars()` — use numeric timestamps throughout

**File: `BacktestExecutor.ts`** (lines 589-640)

- Change `timestamps` from `Set<string>` → `Set<number>`
- Replace `String(bar.timestamp ?? bar.time)` → `bar.time` (already a number from broker)
- `orderedTimestamps` sorted numerically: `.sort((a, b) => a - b)` — no `new Date()` needed
- Forward-fill: `{ ...previousBar, time: timestamp }` instead of `{ ...previousBar, timestamp }`
- Match comparison: `currentBar.time === timestamp` (number === number)

### 2. `recordEquitySnapshot()` — already works

It calls `BarBuffer.toEpochMs(timestamp)` which handles `number` type directly (`typeof timestamp === "number" ? timestamp : ...`). Once we pass numbers, no parsing needed.

### 3. `getMetrics()` line 718 — already works

`new Date(ecData.timestamps[0]).toISOString()` works fine when the Float64Array contains valid epoch ms numbers (not NaN).

### 4. No change to `BarBuffer.toEpochMs()`

The existing implementation handles numbers correctly. The hardening for string-epoch is still good defensive coding but becomes unnecessary for the main path.

## Summary

One file change (`BacktestExecutor.ts`, ~6 lines in `alignMultiSymbolBars`). No timestamp manipulation, no string conversion, no `Date.parse`. Just pass through what the broker sends.

