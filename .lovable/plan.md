# Expand README with Core Features, Tech Stack, and Disclaimer

Restructure `README.md` so it reads like a proper open-source project page. Three additions, written to reflect what Coreza actually ships (no invented libraries or numbers).

## 1. Core Features (replaces the current "✨ Key Features" block)

Three grouped capabilities, each with a one-line intro + sub-bullets:

- **Unified Broker Integration Layer** — config-driven interface across Alpaca, Binance, Dhan, Schwab via `BrokerCapabilities` registry; order management (place / modify / cancel, bracket & basket, idempotent live orders via SHA-256 hash); portfolio (positions, holdings, order book, trade book, cash & PnL snapshots persisted Redis → Supabase); REST quotes, historical bars, symbol search; built-in risk engine node.
- **Real-Time Market Data & Streaming** — unified WebSocket gateway per broker normalized to a single `MarketEvent` schema; Redis pub/sub market-data hub fans one upstream feed to many workflows; bars / quotes / trades / order updates / news (Alpaca); automatic reconnect, Binance listenKey refresh, Schwab OAuth pre-connect; dual Redis topology (`REDIS_QUEUE_URL` for BullMQ, `REDIS_CACHE_URL` for state).
- **Visual Workflow & Strategy Builder** — React Flow node editor with pre-built nodes: market data, 15+ indicators (RSI, MACD, Bollinger, Ichimoku, VWAP, Support/Resistance…), logic (If / Switch / Loop), portfolio, risk, brokers, AI agent, notifications; webhook trigger node for TradingView (manual WS + active BullMQ modes); `{{ $json.field }}` type-safe template interpolation; live execution highlighting, per-node output inspection, execution history with full workflow snapshots; JSON import/export with UUID regeneration; backtesting engine with QuantConnect-style metrics and equity curve.

## 2. Technology Stack (new section, placed after "🏗️ Architecture")

Grouped to match what is actually in this repo:

- **Backend** — Node.js 18+, Express, TypeScript 5.4, BullMQ workers, ioredis, ws, Zod validation, LangChain (AI agent nodes), Supabase JS client.
- **Frontend** — React 18, TypeScript 5, Vite 5, Tailwind CSS 3, shadcn/ui on Radix UI, TanStack Query, React Router, Zustand, framer-motion, React Hook Form.
- **Data Visualization & Editors** — TradingView Lightweight Charts (financial charts), Recharts (dashboards), xyflow / React Flow (visual workflow builder), Lucide React (icons).
- **Data & Infrastructure** — Supabase (PostgreSQL + Auth + Edge Functions + Row Level Security), dual Redis (BullMQ queue + cache), Docker Compose, optional Prometheus + Grafana monitoring stack.
- **Security** — AES-256-GCM credential encryption, JWT auth (global, zero DB lookup), Supabase RLS, derived encryption keys via edge function.
- **Testing & Quality** — Jest (backend unit/integration), Vitest (frontend), Artillery (load tests), ESLint, TypeScript strict mode, module-boundary validator script.

Will list these honestly — won't add Flask/SQLAlchemy/ZeroMQ/SQLite/DuckDB/Playwright/Biome/axe-core since they aren't in the codebase.

## 3. Disclaimer (new section, placed just above "🆘 Support")

Plain text block, our own wording (not copied):

> ## ⚠️ Disclaimer
>
> Coreza is provided for **educational and research purposes only**. It is open-source software, distributed AS-IS without warranty of any kind. Do not trade with money you cannot afford to lose. **You use Coreza entirely at your own risk** — the maintainers, contributors, and affiliates accept no responsibility for any financial losses, missed trades, broker outages, data errors, or other damages arising from its use.
>
> Always backtest and paper-trade your strategies extensively before connecting them to a live brokerage account. Past performance of any strategy, indicator, or backtest result does not guarantee future returns. Trading equities, futures, options, and crypto involves substantial risk of loss and is not suitable for every investor. You are solely responsible for complying with the laws, tax rules, and broker terms of service in your jurisdiction.

The existing "⚠️ Security Notice" at the very bottom stays — it covers a different topic (key hygiene).

## Out of scope

- No image/logo changes.
- No edits to `/docs`, backend READMEs, or `ROADMAP.md`.
- No version bumps in `package.json` to match claimed versions — the stack list is read from what's already installed.
