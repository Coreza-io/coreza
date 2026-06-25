# Dhan Multi-Symbol Historical Bars — Analysis & Plan

## Problem
Entering `HDFCBANK, ICICIBANK` in the Dhan "Get Historical Bars" node fails with:
`Security ID not found for symbol="HDFCBANK, ICICIBANK" segment="NSE_EQ"`.

`buildDhanCandleBaseBody` treats the whole comma string as a single ticker and
calls `lookupSecurityId("HDFCBANK, ICICIBANK", ...)`, which has no match.

## Does the Dhan API support multiple symbols?
**No — not for charts.** Dhan's historical/intraday charts endpoints
(`/v2/charts/historical`, `/v2/charts/intraday`) accept exactly **one
`securityId` per request**. (Only the marketfeed quote/LTP/OHLC endpoints accept
batches — not relevant for candles.)

By contrast, Alpaca works because its bars API (`/v2/stocks/bars`) natively
accepts a comma-separated `symbols` param and returns a `bars` map keyed by
symbol. The Coreza `BrokerExecutor` issues exactly **one axios request per
operation**, so Alpaca's multi-symbol output already maps to a `BarSeries[]`.

**Conclusion:** To support multiple symbols on Dhan we must **fan out N requests
(one per symbol)** and merge the results into a single `BarSeries[]` output —
matching Alpaca's shape. This Dhan-specific fan-out must live only in Dhan files.

## Design rule compliance
The fan-out itself is Dhan-specific (its API limitation), so all looping/merging
logic stays in `dhan/helpers.ts` + `dhan/http/operations.ts`. The only shared
change is a **broker-agnostic `execute` hook** on `BrokerOperation` — a generic
escape hatch any broker can use, with no Dhan logic in common code.

## Changes

### 1. `coreza-backend/src/brokers/types.ts` (generic)
Add an optional `execute` hook + context type to `BrokerOperation`:
```ts
export interface BrokerOperationExecuteContext {
  input: any;
  creds: any;
  baseUrl: string;
  headers: Record<string, string>;
}
// in BrokerOperation:
execute?: (ctx: BrokerOperationExecuteContext) => Promise<any>;
```
When present, the executor delegates the whole request lifecycle to it and uses
its return value directly (skips makeBody/path/axios/pagination/transformResult).

### 2. `coreza-backend/src/nodes/executors/BrokerExecutor.ts` (generic)
After `baseUrl` and `headers` are computed (and before the pagination branch),
add a delegation branch:
```ts
if (op.execute) {
  data = await op.execute({ input: resolvedParams, creds: workingCreds, baseUrl, headers });
} else if (pagination?.enabled && autoPaginate) {
  ...existing...
} else {
  ...existing single request...
}
```
No Dhan-specific references.

### 3. `coreza-backend/src/brokers/dhan/helpers.ts` (Dhan only)
- Add `parseDhanSymbols(raw: string | string[]): string[]` — split on comma,
  trim, uppercase, drop blanks, dedupe.
- Export `fetchDhanCandles(ctx)` that:
  - parses symbols; throws if none.
  - determines daily vs intraday from `interval` (reuse `isDailyCandle` logic —
    move/duplicate the tiny predicate into helpers or import).
  - for each symbol (in parallel via `Promise.all`): build per-symbol input
    `{ ...input, symbol }`, build body via `buildDhanHistoricalBody` /
    `buildDhanIntradayBody`, POST to the right charts path with axios, transform
    via `transformDhanCandles` (returns single-item `BarSeries`).
  - merges all into one `{ BarSeries: [...all items], next_page_token: null,
    has_more: false }`.
  - On a per-symbol lookup/HTTP failure: include a clear error rather than
    aborting the whole batch is optional; default = surface first failure. (Will
    aggregate so one bad symbol reports which symbol failed.)

### 4. `coreza-backend/src/brokers/dhan/http/operations.ts` (Dhan only)
Replace `get_candle`'s `path/makeBody/transformResult` with a single
`execute: (ctx) => fetchDhanCandles(ctx)`. Keep `isDailyCandle` for body choice.

### 5. `src/nodes/Dhan.json` (frontend copy text only)
Update the `symbol` field placeholder/description for `get_candle` to indicate
multiple symbols are allowed, e.g. placeholder `e.g. HDFCBANK, ICICIBANK` and
description noting comma-separated symbols (kept singular wording for
`place_order`, which remains single-symbol).

## Out of scope
`place_order` stays single-symbol (Dhan places one order per request; not
requested here).

## Verification
- `tsgo` typecheck.
- Manual: run "Get Historical Bars" with `HDFCBANK, ICICIBANK` → expect
  `BarSeries` with 2 entries, one per symbol.
