import { BrokerCapabilities } from "../capabilities";
import { extractSchwabOrderOwnerIds } from "./orderOwnerExtract";

export const schwabCapabilities: BrokerCapabilities = {
  id: "schwab",
  displayName: "Schwab",
  historicalTools: {
    get_candle: {
      startField: 'start_date', endField: 'end_date', dateFormat: 'epoch-or-date',
      startAliases: ['startDate', 'start'], endAliases: ['endDate', 'end'],
      timeframe: input => String(input.interval || '1d'),
      validateInterval: input => /^(?:1|5|10|15|30)(?:m|min)$|^1(?:d|day|w|week|mo|month)$/.test(String(input.interval || '1d').trim().toLowerCase()),
      guidance: 'Use interval (default 1d). start_date/end_date accept ISO dates or numeric epochs (seconds or milliseconds); the adapter converts to milliseconds. Without dates the adapter uses a rolling period, not a bar-count limit. No pagination is configured.',
    },
    get_price_history: {
      startField: 'start_date', endField: 'end_date', dateFormat: 'epoch-or-date',
      rangeMode: { field: 'date_mode', value: 'range' },
      startAliases: ['startDate', 'start'], endAliases: ['endDate', 'end'],
      timeframe: input => `${input.frequency || '1'}${({ minute: 'm', daily: 'd', weekly: 'w', monthly: 'month' } as Record<string, string>)[input.frequencyType || 'minute'] || ''}`,
      validateInterval: input => (input.frequencyType || 'minute') === 'minute'
        ? [1, 5, 10, 15, 30].includes(Number(input.frequency || 1))
        : ['daily', 'weekly', 'monthly'].includes(input.frequencyType) && Number(input.frequency || 1) === 1,
      broadenPeriod: input => {
        const periods = ({ day: [1, 2, 3, 4, 5, 10], month: [1, 2, 3, 6], year: [1, 2, 3, 5, 10, 15, 20], ytd: [1] } as Record<string, number[]>)[input.periodType || 'day'];
        const period = periods?.find(value => value > Number(input.period || 10));
        return period ? { period: String(period) } : undefined;
      },
      guidance: 'Use frequencyType/frequency. In range mode use start_date/end_date (ISO or numeric epochs, converted to milliseconds). Otherwise periodType/period select a rolling period (defaults day/10), not a number of bars. Dates override period; no pagination is configured.',
    },
  },

  nodeNames: {
    data: "Schwab",
    trade: "SchwabTrade",
    screener: "SchwabScreener",
    streamData: "SchwabStreamListener",
    subscribe: "SchwabStreamSubscribe",
  },

  streaming: {
    sourceId: "schwab_stream",
    tradingSourceId: "schwab_trading",
    tradingStreams: ["account_activity"],
  },

  streamParser: {
    separator: "@",
    symbolFirst: true,
  },

  orderOwnerExtract: extractSchwabOrderOwnerIds,

  tradingRoutingKey: () => "account_activity",

  supportsAlgoOrders: false,

  assetTypes: ["equity", "options"],

  toolDescriptions: {
    data: "Access equity market data from Charles Schwab.",
    trade: "Place or manage trades via Charles Schwab APIs.",
    screener:
      "Run Charles Schwab screeners to discover equities meeting criteria.",
  },
};

