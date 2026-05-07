
# Fix Missing Node Palette Icons

## Problem
30 out of 35 SVG icon files referenced by node JSON definitions do not exist in `public/assets/icons/`. This causes broken/blank icons for most nodes in the palette. Only 5 icons exist: `broker.svg`, `fmp.svg`, `if.svg`, `store.svg`, `switch.svg`.

## Solution

### 1. Create 30 missing SVG icons in `public/assets/icons/`

Each icon will be a clean, meaningful 24x24 SVG with a primary accent color (`#3B82F6` blue) matching the existing icons. Icons will be simple, recognizable symbols:

| Icon file | Visual concept |
|-----------|---------------|
| `alpaca.svg` | Alpaca "A" lettermark (broker) |
| `adx.svg` | Trend strength wave lines |
| `backtest.svg` | Rewind/history clock |
| `binance.svg` | Binance diamond logo shape |
| `bollinger.svg` | Upper/lower band channel |
| `chat.svg` | Chat bubble |
| `dhan.svg` | "D" lettermark (broker) |
| `ema.svg` | Smooth curve line |
| `gemini.svg` | Gemini star/sparkle |
| `gmail.svg` | Envelope icon |
| `ichimoku.svg` | Cloud shape with line |
| `indicators.svg` | Chart with line overlay |
| `loop.svg` | Circular arrow (repeat) |
| `macd.svg` | Histogram bars with signal line |
| `obv.svg` | Ascending volume bars |
| `openai.svg` | OpenAI hexagonal logo shape |
| `polygon.svg` | Pentagon shape |
| `redis.svg` | Redis diamond stack |
| `risk-engine.svg` | Shield with checkmark |
| `rsi.svg` | Oscillating wave between bounds |
| `scheduler.svg` | Calendar with clock |
| `schwab.svg` | "S" lettermark (broker) |
| `stochastic.svg` | Two crossing oscillator lines |
| `support-resistance.svg` | Horizontal lines with price between |
| `telegram.svg` | Paper plane |
| `visualize.svg` | Bar chart / eye |
| `volume-oscillator.svg` | Oscillating volume bars |
| `vwap.svg` | Price line with volume area |
| `whatsapp.svg` | Phone in chat bubble |
| `FinnHub.svg` | "F" lettermark |
| `YahooFinance.svg` | "Y!" lettermark |

### 2. Fix edge-case icon paths in NodePalette.tsx

Update the `NodePalette` icon resolution to handle these edge cases that currently fall through:
- `HttpRequest` node uses `"Globe"` (Lucide name) -- already handled by `getIconComponent` fallback
- `Market` node uses `"Building2"` -- add `Building2` to the Lucide icon map
- `WebhookTrigger` uses `"webhook"` -- map to a Lucide icon (e.g., `Globe` or `Radio`)
- `TelegramTrigger` uses `"telegram"` -- fix to use `/assets/icons/telegram.svg`
- `InMemory` and `RollingWindow` use `"store.svg"` (missing `/assets/icons/` prefix) -- fix in JSON

### 3. Fix node JSON icon paths

Update 3 node JSON files with incorrect icon paths:
- `InMemory.json`: `"store.svg"` → `"/assets/icons/store.svg"`
- `RollingWindow.json`: `"store.svg"` → `"/assets/icons/store.svg"`
- `TelegramTrigger.json`: `"telegram"` → `"/assets/icons/telegram.svg"`
- `WebhookTrigger.json`: `"webhook"` → add to Lucide map or create SVG

### Files changed
- **30 new files** in `public/assets/icons/` (SVG icons)
- **`src/components/workflow/NodePalette.tsx`** -- add `Building2` to Lucide icon map
- **`src/nodes/InMemory.json`** -- fix icon path
- **`src/nodes/RollingWindow.json`** -- fix icon path
- **`src/nodes/TelegramTrigger.json`** -- fix icon path
- **`src/nodes/WebhookTrigger.json`** -- fix icon path or add SVG
