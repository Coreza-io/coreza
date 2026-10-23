# Unified node result implementation

The portable source is `coreza-backend/src/contracts/nodeResult.ts`. Canonical results always contain `status` and `data`, with no `success` or `formatVersion`. Explicit success construction preserves every business payload key and its reference. Classic and compiled adapters preserve lifecycle, details, metadata and routing control; compiled sync calls remain synchronous. Shared type/constructor facades replace the two previous implementations.

## Boundaries and compatibility

- All registered executor public and private result methods use the shared NodeResult type. Direct success/failure/listener literals use shared constructors; broker, indicator, Loop, storage and trading algorithms retain their existing computations. The former loose NodeResult type is removed. The former `toNodeResult` name is a lossless identity facade, not the old projection.
- Legacy sources are executor, manual, history, pin and listener; explicit payload construction never guesses an envelope. A bare provider `{data, pagination}` remains intact. Recognized lifecycle status takes precedence except that explicit failure cannot become success. Contradictory old success/error fields carry `meta.legacyStatusConflict` and a fallback diagnostic code without discarding an existing provider code. Cancellation stays distinct from failure. Old control/metadata are retained internally. Known sibling fields on old envelopes are retained in `meta.legacyFields`.
- `NodeResultError` carries structured failure data through classic/compiled failure propagation. Owned child snapshots are retained before failure. Continue-on-error uses its existing routing selection rather than a new global status routing policy. LoopV2 remains an internal item/control protocol adapted by ControlFlowExecutor; its error/control/meta survive the conversion.
- The editor opts into canonical HTTP results with `X-Coreza-Node-Result: canonical`. Middleware adapts only that explicit ingress; old node requests identified by known node-operation routes or node ID/name have a named legacy success-flag HTTP adapter. Credential/model/metadata/workflow-run requests keep their own protocols. Variable snapshots and Agent activity remain transport attachments. HTTP Request has a node-specific adapter: its response body remains `.data`, while HTTP status moves into `meta.http`. No broker order is retried or resubmitted by these adapters.
- `publishNodeResult` guards and publishes accepted normal results, local/Loop results, failures and listener/socket updates to canonical data, runtime storage and local output, then notifies once. Pin precedence and session/deletion guards remain in place. Listener timeout/expiry map to error with stable codes; an explicit stop is cancelled. Continuous streams keep their original routing policy.
- History uses the same decoder, without rewriting saved rows or manufacturing timestamps. Output displays details/meta as well as status/data. Saved pins and preview/input sources use explicit legacy ingress. Rendering uses memoized results, and canonical recognition/finalization preserve identity when unchanged.
- Runtime control is removed at public publication/serialization. Actual Redis run-history writes and backtest activation snapshots project node results to the public contract while leaving workflow-run success/error envelopes separate. AI tools retain the canonical executor result until their existing bounded summary/dataRef adapter; those LLM projections are a distinct protocol.

## Metadata, diagnostics and JSON policy

Hot construction never reads the clock. Observed finalization adds only supplied context fields and retains existing metadata. Invocation owners supply timestamps/durations; `startTime` alone does not fabricate a later observation time. Listener timestamps already captured at publication are retained. Domain metadata extensions remain supported, including readiness and persistent variable keys. HTTP transport explicitly omits optional indicator `meta.series`; internal AI readiness still has it.

Error details allow scalar code/provider/status/recoverable/reason and selected response fields (message/error/code/status/reason/requestId). Axios extraction stays server-side; request/config objects are never serialized by the portable module. Public JSON validation rejects non-finite numbers, bigint, functions, symbols, cycles and non-plain class instances with `OUTPUT_NOT_SERIALIZABLE`. Dates use ordinary JSON ISO encoding. Undefined payload becomes null; JSON omits undefined object properties and represents undefined array entries as null. Constructors do not walk/clone/freeze payloads; validation occurs only at an actual public JSON boundary.

## Scope and unexecuted gates

No tests, type checks, lint, builds, browser checks, broker requests, benchmarks, baseline fixtures or performance measurements were run, as requested. Source review and `git diff --check` are the only verification. The optional `npm run check:node-results` static guard is included but was not run. The plan's correctness/performance/rollout acceptance gates remain unverified; no throughput or memory claim is made.

This PR implements the shared contract, producers, migration boundaries and an optional static contract guard. Manifest-derived runtime regression coverage and acceptance evidence remain follow-ups after validation is authorized. Existing unsupported node/mode combinations are not made executable by an output formatter. No scheduler, broker, database schema, dependency or expression-language redesign is included. Deploy the compatible frontend readers with/before canonical server producers; old HTTP callers use the named transport adapter. Rollback keeps readers and changes producer enablement; saved rows need no conversion.

## Authored node and operation inventory

The following table is generated from all 73 authored definitions and the existing category mapping. Operations list the declared operation/mode/method options. Manual, cluster and Run All use normal editor actions; server live/classic/compiled paths use the executor boundary where supported. Model/memory attachments do not execute merely to populate output. This inventory describes source ownership, not evidence that every operation/mode has passed runtime acceptance.

| Definition | Runtime name | Existing owner/entry | Method | Manual endpoint | Declared operations/modes |
| --- | --- | --- | --- | --- | --- |
| ADX | ADX | Indicators executor / normal editor action | POST | /indicators/adx | definition fields |
| AIAgent | AIAgent | AIAgent executor / normal editor action | POST | /aiagent/execute | definition fields |
| ATR | ATR | Indicators executor / normal editor action | POST | /indicators/atr | definition fields |
| Alpaca | Alpaca | Broker executor / normal editor action | {{method}} | /broker/alpaca/{{operation}} | get_account / get_positions / get_orders / get_order / get_trades / cancel_order / cancel_all_orders / get_candle / get_latest_bar / fetch_news / place_order / close_position |
| AlpacaScreener | AlpacaScreener | Screener executor / normal editor action | POST | /screener/alpaca/{{operation}} | most_actives / market_movers |
| AlpacaStreamData | AlpacaStreamListener | manual endpoint/listener; live event ingress | POST | /stream/alpaca/register | listen / subscribe |
| AlpacaSubscribe | AlpacaStreamSubscribe | manual endpoint/listener; live event ingress | POST | /stream/alpaca/{{operation}} | subscribe / unsubscribe |
| BB | Bollinger Bands | Indicators executor / normal editor action | POST | /indicators/bollinger | definition fields |
| BacktestInit | BacktestInit | Backtest executor / normal editor action | POST | /backtest/init | definition fields |
| BacktestPortfolio | BacktestPortfolio | Backtest executor / normal editor action | POST | /backtest/portfolio | get_portfolio / get_position / update_mtm / get_cash / get_equity / get_pending_orders / get_trades |
| BacktestResults | BacktestResults | Backtest executor / normal editor action | POST | /backtest/results | definition fields |
| BacktestTrade | BacktestTrade | Backtest executor / normal editor action | POST | /backtest/trade | place_order / liquidate |
| Binance | Binance | Broker executor / normal editor action | POST | /broker/binance/{{operation}} | get_account / get_positions / get_orders / get_trades / get_candle / get_ticker / place_order / cancel_order |
| BinanceScreener | BinanceScreener | Screener executor / normal editor action | POST | /screener/binance/{{operation}} | top_gainers / top_losers / most_active / new_listings |
| BinanceStreamData | BinanceStreamListener | manual endpoint/listener; live event ingress | POST | /stream/binance/register | listen / subscribe |
| BinanceSubscribe | BinanceStreamSubscribe | manual endpoint/listener; live event ingress | POST | /stream/binance/{{operation}} | subscribe / unsubscribe |
| ChatInput | ChatInput | IOExecutor / frontend local payload | local | local/configuration | definition fields |
| Compute | Compute | ControlFlow executor / normal editor action | POST | /comparator/compute | definition fields |
| Consolidator | Consolidator | Consolidator executor / normal editor action | POST | /storage/consolidator | definition fields |
| Dhan | Dhan | Broker executor / normal editor action | {{method}} | /broker/dhan/{{operation}} | get_account / get_positions / get_holdings / get_orders / get_trades / get_order_by_id / modify_order / cancel_order / get_candle / place_order |
| DhanStreamData | DhanStreamListener | manual endpoint/listener; live event ingress | POST | /stream/dhan/register | listen / subscribe |
| DhanSubscribe | DhanStreamSubscribe | manual endpoint/listener; live event ingress | POST | /stream/dhan/{{operation}} | subscribe / unsubscribe |
| DocumentExtract | DocumentExtract | Document executor / normal editor action | POST | /documents/extract | definition fields |
| EMA | EMA | Indicators executor / normal editor action | POST | /indicators/ema | definition fields |
| FMP | FMP | DataSourceExecutor / direct endpoint | POST | /datasource/fmp/:operation | profile / quote / income_statement / balance_sheet / cash_flow / key_metrics / ratios / financial_growth / financial_scores / enterprise_value / stock_peers / analyst_estimates / price_target / earnings_calendar / dividends / splits / insider_trading / institutional_holders |
| FMPNews | FMPNews | DataSourceExecutor / direct endpoint | POST | /datasource/fmpNews/:operation | general_news / stock_news / press_releases / crypto_news / forex_news / fmp_articles / search_stock_news / search_press_releases / search_crypto_news / search_forex_news |
| FMPScreener | FMPScreener | Screener executor / normal editor action | POST | /screener/fmp/{{operation}} | definition fields |
| Field | Edit Fields | ControlFlow executor / normal editor action | POST | /comparator/field | definition fields |
| FinnHub | FinnHub | DataSource executor / normal editor action | POST | /finnhub/get-quote | definition fields |
| GeminiChatModel | GeminiChatModel | configuration attachment (no fabricated result) | local | local/configuration | definition fields |
| Gmail | Gmail | Communication executor / normal editor action | POST | /communication/gmail/send | definition fields |
| GmailTrigger | GmailTrigger | TriggerExecutor / manual listener | POST | /webhooks/register | definition fields |
| GoogleWebSearch | GoogleWebSearch | ToolExecutor when invoked by Agent | POST | /googlesearch/execute | definition fields |
| HttpRequest | HttpRequest | DataSourceExecutor / direct endpoint | POST | /http/request | GET / POST / PUT / DELETE / PATCH / HEAD / OPTIONS |
| Ichimoku | Ichimoku Cloud | Indicators executor / normal editor action | POST | /indicators/ichimoku | definition fields |
| If | If | ControlFlow executor / normal editor action | POST | /comparator/if | definition fields |
| InMemory | InMemory | DataSourceExecutor / direct endpoint | local | local/configuration | None / None / None / None / None / None / None |
| InitializeIndicators | InitializeIndicators | Indicators executor / normal editor action | POST | /indicators/initialize | definition fields |
| Loop | Loop | ControlFlow executor / normal editor action | local | local/configuration | definition fields |
| MACD | MACD | Indicators executor / normal editor action | POST | /indicators/macd | definition fields |
| Market | Market | DataSourceExecutor / direct endpoint | POST | /market/market_info | definition fields |
| OBV | OBV | Indicators executor / normal editor action | POST | /indicators/obv | definition fields |
| OnBar | OnBar | Backtest executor / normal editor action | POST | /backtest/onbar | definition fields |
| OpenAI | OpenAI | existing direct endpoint / model tool adapter | POST | /openai/chat | definition fields |
| OpenAIChatModel | OpenAIChatModel | configuration attachment (no fabricated result) | local | local/configuration | definition fields |
| Polygon | Polygon | DataSourceExecutor / direct endpoint | POST | /datasource/polygon/:operation | ticker_details / financials / dividends / splits / news / related_companies |
| Portfolio | Portfolio | Portfolio executor / normal editor action | POST | /portfolio | backtest / broker / create_portfolio / register_order_intent / sync_order_event / get_open_orders / get_portfolio / get_position / update_mtm / get_cash / get_equity / get_trades |
| PostgresChatMemory | PostgresChatMemory | configuration attachment (no fabricated result) | local | local/configuration | definition fields |
| RSI | RSI | Indicators executor / normal editor action | POST | /indicators/rsi | definition fields |
| RedisChatMemory | RedisChatMemory | configuration attachment (no fabricated result) | local | local/configuration | definition fields |
| RedisStore | RedisStore | DataSourceExecutor / direct endpoint | POST | /storage/redis/:operation | None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None / None |
| RedisTrigger | RedisTrigger | DataSourceExecutor / direct endpoint | POST | /storage/redisTrigger/subscribe | definition fields |
| RiskEngine | Risk Engine | Risk Management executor / normal editor action | POST | /risk/engine | definition fields |
| RollingWindow | RollingWindow | Indicators executor / normal editor action | POST | /storage/rolling-window | None / None |
| Scheduler | Scheduler | Utility executor / normal editor action | POST | /execute/scheduler | definition fields |
| Schwab | Schwab | Broker executor / normal editor action | POST | /broker/schwab/{{operation}} | get_account / get_positions / get_orders / get_quotes / get_price_history / place_order |
| SchwabScreener | SchwabScreener | Screener executor / normal editor action | POST | /screener/schwab/{{operation}} | get_fundamentals / movers / get_instruments / get_instrument_cusip |
| SchwabStreamData | SchwabStreamListener | manual endpoint/listener; live event ingress | POST | /stream/schwab/register | listen / subscribe |
| SchwabSubscribe | SchwabStreamSubscribe | manual endpoint/listener; live event ingress | POST | /stream/schwab/{{operation}} | subscribe / unsubscribe |
| SimpleMemory | SimpleMemory | configuration attachment (no fabricated result) | local | local/configuration | definition fields |
| Stoch | Stochastic Oscillator | Indicators executor / normal editor action | POST | /indicators/stochastic | definition fields |
| Store | Store | DataSource executor / normal editor action | POST | /storage/store/:operation | definition fields |
| SupportResistance | Support & Resistance | Indicators executor / normal editor action | POST | /indicators/support-resistance | None / None / None |
| Switch | Switch | ControlFlow executor / normal editor action | POST | /comparator/switch | definition fields |
| Telegram | Telegram | Communication executor / normal editor action | POST | /communication/telegram/send_message | None / None / None |
| TelegramTrigger | TelegramTrigger | TriggerExecutor / manual listener | POST | /webhooks/register | definition fields |
| VWAP | VWAP | Indicators executor / normal editor action | POST | /indicators/vwap | definition fields |
| Visualize | Visualize | Utility executor / normal editor action | local | local/configuration | definition fields |
| VolumeOscillator | VolumeOscillator | Indicators executor / normal editor action | POST | /indicators/volume-oscillator | definition fields |
| WebhookTrigger | WebhookTrigger | TriggerExecutor / manual listener | POST | /webhooks/register | definition fields |
| WhatsApp | WhatsApp | Communication executor / normal editor action | POST | /communication/whatsapp/send_message | None |
| YahooFinance | YahooFinance | DataSource executor / normal editor action | POST | /datasource/yahoofinance/:operation | get_history |
| YahooFinanceScreener | YahooFinanceScreener | Screener executor / normal editor action | POST | /screener/yahoofinance/{{operation}} | day_gainers / day_losers / most_actives / small_cap_gainers / undervalued_large_caps / growth_technology_stocks / aggressive_small_caps / undervalued_growth_stocks |
