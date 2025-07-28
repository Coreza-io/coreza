// src/services/brokers/configs/dhan.ts

import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import { RestConfig } from '../RestBrokerService';
import { BrokerInput } from '../types';

interface DhanCreds {
  api_key: string;
  // add other cred fields if needed
}

// In‑memory cache & loader promise
let scripMasterCache: Map<string, string> | null = null;
let loadingPromise: Promise<Map<string, string>> | null = null;

/**
 * Loads and caches the Dhan scrip master CSV into a Map<"SYMBOL_SEGMENT", "SECURITY_ID">.
 * Subsequent calls will return the same Map instantly.
 */
async function loadScripMaster(): Promise<Map<string, string>> {
  if (scripMasterCache) {
    return scripMasterCache;
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = new Promise<Map<string, string>>((resolve, reject) => {
    const map = new Map<string, string>();
    const csvFilePath = path.resolve(
      __dirname,
      '../../../data/api-scrip-master-detailed.csv'
    );

    if (!fs.existsSync(csvFilePath)) {
      console.warn('Dhan scrip master CSV file not found. Skipping load.');
      scripMasterCache = map;
      return resolve(map);
    }

    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row: Record<string, string>) => {
        const symbol = row['UNDERLYING_SYMBOL']?.trim();
        const securityId = row['SECURITY_ID']?.trim();
        const exchangeSegment = row['EXCH_ID']?.trim();

        if (symbol && securityId && exchangeSegment) {
          // Use only the base segment (e.g., "NSE" from "NSE_EQ")
          const baseSegment = exchangeSegment.split('_')[0];
          const key = `${symbol}_${baseSegment}`;
          map.set(key, securityId);
        }
      })
      .on('end', () => {
        scripMasterCache = map;
        resolve(map);
      })
      .on('error', (err) => {
        console.error('Error loading Dhan scrip master CSV:', err);
        reject(err);
      });
  });

  return loadingPromise;
}

/**
 * Lookup the securityId for a given symbol+segment.
 * Uses only the base segment for lookup (e.g., "NSE" from "NSE_EQ").
 */
async function lookupSecurityId(
  symbol: string,
  exchangeSegment: string
): Promise<string> {
  const map = await loadScripMaster();
  const baseSegment = exchangeSegment.split('_')[0];
  const key = `${symbol}_${baseSegment}`;
  return map.get(key) || '';
}

// --- Kick off the load once at startup, and log results ---
loadScripMaster()
  .then((map) => {
    console.log(`✅ Loaded ${map.size} scrip mappings`);
    console.log('Samples:', Array.from(map.entries()).slice(0, 5));
  })
  .catch(() => {
    /* error already logged above */
  });

// --- Exported Dhan REST config ---
export const dhanConfig: RestConfig = {
  baseUrl: process.env.DHAN_API_BASE_URL || 'https://sandbox.dhan.co/v2',

  makeAuthHeaders: (creds: DhanCreds) => ({
    'access-token': creds.api_key,
    'Content-Type': 'application/json',
  }),

  ops: {
    get_account: {
      method: 'get',
      path: '/funds',
    },

    get_positions: {
      method: 'get',
      path: '/positions',
    },

    get_holdings: {
      method: 'get',
      path: '/holdings',
    },

    get_orders: {
      method: 'get',
      path: '/orders',
    },

    get_candle: {
      method: 'post',
      path: '/charts/historical',
      makeBody: async (input: BrokerInput) => {
        const {
          symbol,
          exchange_segment = 'NSE_EQ',
          from_date,
          to_date,
          lookback,
          timeframe = '1',
        } = input;

        if (!symbol) {
          throw new Error('Symbol is required for get_candle');
        }

        // resolve security ID
        const securityId = await lookupSecurityId(symbol, exchange_segment);
        if (!securityId) {
          throw new Error(
            `Security ID not found for symbol="${symbol}" segment="${exchange_segment}"`
          );
        }

        // compute dates if lookback is provided
        let startDate = from_date;
        let endDate = to_date;
        const lb = Number(lookback) || 0;

        if ((!startDate || !endDate) && lb > 0) {
          const now = new Date();
          const sd = new Date(now);

          if (timeframe.endsWith('Min')) {
            sd.setMinutes(now.getMinutes() - lb);
          } else if (timeframe.endsWith('Hour')) {
            sd.setHours(now.getHours() - lb);
          } else {
            sd.setDate(now.getDate() - lb);
          }

          startDate = startDate || sd.toISOString();
          endDate = endDate || now.toISOString();
        }

        if (!startDate || !endDate) {
          throw new Error('Either lookback or both from_date and to_date must be provided');
        }

        return {
          securityId,
          exchangeSegment: exchange_segment,
          instrument: 'EQUITY',
          fromDate: startDate,
          toDate: endDate,
          expiryCode: 0,
          oi: false
        };
      },
      transformResult: (raw: any, input: BrokerInput) => {
        // If Dhan returned arrays for OHLCV, zip them to {t, o, h, l, c, v}
        const open   = raw.open   || [];
        const high   = raw.high   || [];
        const low    = raw.low    || [];
        const close  = raw.close  || [];
        const volume = raw.volume || [];
        const ts     = raw.timestamp || [];

        let candles: any[] = [];

        if (
          Array.isArray(open) && Array.isArray(high) && Array.isArray(low) &&
          Array.isArray(close) && Array.isArray(volume) && Array.isArray(ts)
        ) {
          // "zip" to array of { t, o, h, l, c, v }
          for (let i = 0; i < open.length; ++i) {
            candles.push({
              t: ts[i], // you may want to convert to ISO if it's a unix or seconds
              o: open[i],
              h: high[i],
              l: low[i],
              c: close[i],
              v: volume[i]
            });
          }
        } else if (Array.isArray(raw.data)) {
          // fallback: if Dhan returned already array of objects
          candles = raw.data.map((bar: any) => ({
            t: bar.timestamp || bar.t || bar.T,
            o: bar.open      || bar.o || bar.O,
            h: bar.high      || bar.h || bar.H,
            l: bar.low       || bar.l || bar.L,
            c: bar.close     || bar.c || bar.C,
            v: bar.volume    || bar.v || bar.V
          }));
        } else {
          candles = [];
        }

        return {
          symbol: input.symbol,
          candles
        };
      }
    },
  },
};
