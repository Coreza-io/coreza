export const ALPACA_WS_CHANNELS = {
  trades: 'trades',
  quotes: 'quotes',
  bars: 'bars',
  dailyBars: 'dailyBars',
  updatedBars: 'updatedBars',
} as const;

export type AlpacaWsChannel = (typeof ALPACA_WS_CHANNELS)[keyof typeof ALPACA_WS_CHANNELS];
