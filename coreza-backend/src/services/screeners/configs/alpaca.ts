import { RestScreenerConfig } from '../RestScreenerService';
import { ScreenerInput } from '../types';

export const alpacaScreenerConfig: RestScreenerConfig = {
  baseUrl: "https://data.alpaca.markets",
  
  makeAuthHeaders: (creds: any) => ({
    "APCA-API-KEY-ID": creds.api_key,
    "APCA-API-SECRET-KEY": creds.secret_key,
  }),

  ops: {
    most_actives: {
      method: "get",
      path: "/v1beta1/screener/stocks/most-actives",
      makeParams: (input: ScreenerInput) => {
        const params: any = {};
        if (input.top) params.top = Number(input.top);
        if (input.by) params.by = input.by; // "volume" | "trades"
        return params;
      },
      transformResult: (raw: any) => ({
        most_actives: raw.most_actives || [],
        count: raw.most_actives?.length || 0,
        last_updated: raw.last_updated || null
      })
    },

    market_movers: {
      method: "get",
      path: (input: ScreenerInput) => {
        const marketType = input.market_type || "stocks";
        return `/v1beta1/screener/${marketType}/movers`;
      },
      makeParams: (input: ScreenerInput) => {
        const params: any = {};
        if (input.top) params.top = Number(input.top);
        return params;
      },
      transformResult: (raw: any) => ({
        gainers: raw.gainers || [],
        losers: raw.losers || [],
        gainers_count: raw.gainers?.length || 0,
        losers_count: raw.losers?.length || 0,
        market_type: raw.market_type || null,
        last_updated: raw.last_updated || null
      })
    }
  }
};
