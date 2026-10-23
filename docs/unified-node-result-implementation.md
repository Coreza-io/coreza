# Unified node result implementation

The portable source is `coreza-backend/src/contracts/nodeResult.ts`. Executable node results contain `status` and `data`, with optional diagnostics, metadata and internal control. There is no `success` boolean or format version on a node result.

## Current contract only

- Executors, classic/compiled runtimes, manual node endpoints, listeners, pins, previews and history use the same current contract. `readNodeResult` validates that contract and returns `INVALID_NODE_RESULT` for incompatible values; it never guesses an envelope from payload keys or converts older saved output formats.
- Removed the old-format decoder and source tags, contradictory-status handling, old metadata retention fields, compatibility type/normalizer modules, identity conversion aliases, HTTP success-flag response adapter, request negotiation header, older-backend HTTP fallback and older WebSocket event reader.
- Current node endpoints construct status/data results directly. Provider/service operation responses and workflow-run/LLM protocols remain separate active protocols; explicit service-to-node translation is not a previous-version node-result reader. Authentication, credential, model and workflow-run APIs retain their own contracts.
- Waiting/listening/streaming outputs and timeout/expiry errors are constructed at their actual producers. Socket events carry captured timestamps. Business payloads remain under data, including falsy values and payloads containing data/status/success/error keys. HTTP Request response metadata is under meta.http; variable snapshots and Agent activity are transport attachments.
- Normal/local/Loop results, failures and listener/socket updates share guarded editor publication. Continued failures preserve diagnostics, partial data and metadata; continuation selection is separate from public output. Server cluster pins are current results without an extra envelope. Null/undefined means unpinned.
- Public projection strips engine control and limits error diagnostics. Redis and direct SQL history use the same persistence projection for node results and edge-keyed cluster boundary values, omitting internal error causes. Hot construction does not walk payloads or read the clock; JSON validation runs only at serialization boundaries.

Older clients, stored output envelopes and raw pinned-output formats are no longer supported. Frontend and backend must deploy together. Existing historical rows are not rewritten; incompatible rows display an explicit contract error. Canonical pins with data equal to false, zero, an empty string or null retain those values.

## Metadata and JSON policy

Observed finalization adds supplied identity/timing metadata while retaining existing fields; it does not manufacture read-time timestamps. Constructors preserve payload references. Error details permit scalar code/provider/status/recoverable/reason and selected scalar response diagnostics. Axios extraction remains server-side. Public JSON rejects non-finite numbers, bigint, functions, symbols, cycles and non-plain instances with OUTPUT_NOT_SERIALIZABLE. Dates use JSON ISO encoding; undefined payload becomes null.

## Live execution overhead

Executor results are checked once by the runtime and written to a typed internal store. External seeds and pins still validate at ingress. Envelope checks avoid per-call key arrays; success construction without metadata context skips observed metadata finalization.

Live Redis history uses `stringifyWorkflowRunResult`: node payload validation runs inside JSON encoding, with no separate recursive payload pre-scan and no second JSON encoding of those node payloads. A cache scoped to one synchronous history write reuses encoded results referenced by boundary edges or aliases. Invalid/cyclic payloads still produce OUTPUT_NOT_SERIALIZABLE; public projection still strips engine control and internal error causes. The direct SQL/object transport projection retains its existing validation.

History remains awaited before event acknowledgement. These changes remove identified duplicate work; they do not establish zero overhead or measured latency improvement. No timings or benchmarks were run.

## Scope and validation

No tests, type checks, lint, builds, browser checks, broker requests, custom static guard or benchmarks were run, as requested. Source review and git diff --check are the only verification. Existing regression fixtures need updating for this intentional removal of older formats; runtime correctness and performance acceptance remain unverified.

No scheduler, broker algorithm, database schema, dependency or expression-language redesign. The current internal Loop item/control protocol is explicitly adapted at its executor boundary. Model/memory attachments do not fabricate execution results. The optional source guard and operation inventory remain included.

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
