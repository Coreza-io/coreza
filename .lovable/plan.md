# Update README with structured Core Features section

Replace the current short "Key Features" bullet list in `README.md` with a richer "Core Features" section modeled on the format you shared, but rewritten to match what Coreza actually ships today (no invented endpoints or ports).

## Where it goes

In `README.md`, replace the existing **✨ Key Features** block (between "🔐 Security Features" and "💡 Why Open Source?") with a new **🧩 Core Features** section. Everything else (Quick Start, Architecture, Security, Setup, License, etc.) stays untouched.

## New section structure

Three grouped capabilities, each with a short intro line + sub-bullets, mirroring the style of the sample:

1. **Unified Broker Integration Layer**
   - One config-driven interface across Alpaca, Binance, Dhan, Schwab (and pluggable new brokers via `BrokerCapabilities` registry)
   - Order management: place / modify / cancel, bracket & basket orders, idempotent live orders (SHA-256 param hash)
   - Portfolio: positions, holdings, order book, trade book, cash & PnL snapshots persisted via Redis → Supabase
   - Market data: REST quotes, historical bars, symbol search
   - Built-in risk engine node for position sizing and exposure checks

2. **Real-Time Market Data & Streaming**
   - Unified WebSocket gateway per broker with normalized `MarketEvent` schema
   - Redis pub/sub market-data hub fans one upstream feed out to many workflows
   - Stream types: bars (1m/1d), quotes, trades, order updates, news (Alpaca)
   - Automatic reconnection, listen-key refresh (Binance), Schwab OAuth pre-connect
   - Dual Redis topology: `REDIS_QUEUE_URL` (BullMQ) + `REDIS_CACHE_URL` (state)

3. **Visual Workflow & Strategy Builder**
   - Node-based editor powered by React Flow with pre-built nodes: market data, 15+ indicators (RSI, MACD, Bollinger, Ichimoku, VWAP, Support/Resistance…), logic (If / Switch / Loop), portfolio, risk, brokers, AI agent, notifications
   - Webhook trigger node (manual WS preview mode + active BullMQ mode) for TradingView and external signals
   - `{{ $json.field }}` template interpolation with type-safe resolution
   - Live execution highlighting, per-node output inspection, execution history with full workflow snapshots
   - JSON import/export with automatic UUID regeneration for safe sharing
   - Backtesting engine with QuantConnect-style metrics and equity curve

A short closing line points readers to `/docs` for the deeper architecture notes already linked below.

## Out of scope

- No claims about specific endpoint counts ("30+ endpoints"), port numbers (8765), or ZeroMQ — those aren't in our stack.
- No changes to other README sections, no new images, no doc-site edits.
