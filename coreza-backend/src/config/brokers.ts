import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface BrokerOperation {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string | ((input: any, creds?: any) => string);
  makeParams?: (input: any) => Record<string, any>;
  makeBody?: (input: any, creds?: any) => any | Promise<any>;
  transformResult?: (data: any, input: any) => any;
}

export interface BrokerConfig {
  authType: 'api_key' | 'oauth';
  baseUrl: string | ((creds: any, input?: any) => string);
  makeAuthHeaders: (creds: any) => Record<string, string> | Promise<Record<string, string>>;
  operations: Record<string, BrokerOperation>;
}

// ============================================
// DHAN SCRIP MASTER UTILITIES
// ============================================

let scripMasterCache: Map<string, string> | null = null;
let loadingPromise: Promise<Map<string, string>> | null = null;

async function loadScripMaster(): Promise<Map<string, string>> {
  if (scripMasterCache) return scripMasterCache;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<Map<string, string>>((resolve, reject) => {
    const map = new Map<string, string>();
    const csvFilePath = path.resolve(
      __dirname,
      '../../data/api-scrip-master-detailed.csv'
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
          const baseSegment = exchangeSegment.split('_')[0];
          const key = `${symbol}_${baseSegment}`;
          map.set(key, securityId);
        }
      })
      .on('end', () => {
        scripMasterCache = map;
        console.log(`✅ Loaded ${map.size} Dhan scrip mappings`);
        resolve(map);
      })
      .on('error', (err) => {
        console.error('Error loading Dhan scrip master CSV:', err);
        reject(err);
      });
  });

  return loadingPromise;
}

async function lookupSecurityId(symbol: string, exchangeSegment: string): Promise<string> {
  const map = await loadScripMaster();
  const baseSegment = exchangeSegment.split('_')[0];
  const key = `${symbol}_${baseSegment}`;
  return map.get(key) || '';
}

// Preload on startup
loadScripMaster().catch(() => {});

// ============================================
// SCHWAB TOKEN REFRESH UTILITY
// ============================================

export async function refreshSchwabTokenIfNeeded(creds: any): Promise<any> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = creds.token_expires_at || 0;

  if (now >= expiresAt - 60) {
    console.log('🔄 [SCHWAB] Access token expired, refreshing...');

    try {
      const credentials = `${creds.app_key}:${creds.app_secret}`;
      const encodedCredentials = Buffer.from(credentials).toString('base64');

      const response = await axios.post(
        'https://api.schwabapi.com/v1/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: creds.refresh_token,
        }),
        {
          headers: {
            Authorization: `Basic ${encodedCredentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const newTokens = response.data;
      const newExpiresAt = now + newTokens.expires_in;

      console.log('✅ [SCHWAB] Token refreshed successfully');

      // Update credentials in database
      const { supabase } = await import('../config/supabase');
      const EnvelopeEncryptionUtil = (await import('../utils/envelopeEncryption')).default;

      const { data: credentialRecord } = await supabase
        .from('user_credentials')
        .select('*')
        .eq('service_type', 'schwab')
        .eq('client_json->>access_token', creds.access_token)
        .single();

      if (credentialRecord) {
        const payload = {
          service_type: 'schwab',
          name: credentialRecord.name,
          client: {
            app_key: creds.app_key,
            app_secret: creds.app_secret,
          },
          token: {
            access_token: newTokens.access_token,
            refresh_token: creds.refresh_token,
            token_expires_at: newExpiresAt,
          },
          meta: {
            account_number: creds.account_number,
            last_token_refresh: new Date().toISOString(),
          },
        };

        const encrypted = EnvelopeEncryptionUtil.encrypt(payload, credentialRecord.user_id);

        await supabase
          .from('user_credentials')
          .update({
            enc_payload: encrypted.encPayload,
            iv: encrypted.iv,
            auth_tag: encrypted.authTag,
            dek_wrapped: encrypted.dekWrapped,
            updated_at: new Date().toISOString(),
          })
          .eq('id', credentialRecord.id);
      }

      return {
        ...creds,
        access_token: newTokens.access_token,
        token_expires_at: newExpiresAt,
      };
    } catch (error: any) {
      throw new Error(
        `Token refresh failed: ${error.message}. Please re-authenticate your Schwab account.`
      );
    }
  }

  return creds;
}

// ============================================
// BROKER CONFIGURATIONS
// ============================================

export const BROKER_CONFIGS: Record<string, BrokerConfig> = {
  // ============================================
  // ALPACA
  // ============================================
  alpaca: {
    authType: 'api_key',
    baseUrl: (creds: any, input?: any) => {
      if (input?.operation === 'get_candle' || input?.operation === 'get_latest_bar') {
        return 'https://data.alpaca.markets';
      }
      return input?.environment === 'live'
        ? 'https://api.alpaca.markets'
        : 'https://paper-api.alpaca.markets';
    },
    makeAuthHeaders: (creds: any) => ({
      'APCA-API-KEY-ID': creds.api_key,
      'APCA-API-SECRET-KEY': creds.secret_key,
    }),
    operations: {
      get_account: {
        method: 'get',
        path: '/v2/account',
      },
      get_positions: {
        method: 'get',
        path: '/v2/positions',
      },
      get_orders: {
        method: 'get',
        path: '/v2/orders',
        makeParams: () => ({
          status: 'all',
          limit: '100',
        }),
      },
      cancel_orders: {
        method: 'delete',
        path: '/v2/orders',
      },
      get_candle: {
        method: 'get',
        path: (input: any) =>
          input.asset_type === 'crypto' ? '/v1beta3/crypto/us/bars' : '/v2/stocks/bars',
        makeParams: (input: any) => {
          if (!input.symbol) throw new Error('Symbol is required for get_candle operation');
          return {
            symbols: input.symbol,
            timeframe: input.interval,
            start: input.start,
            ...(input.end ? { end: input.end } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
            adjustment: 'raw',
            feed: input.feed,
            sort: input.sort,
          };
        },
        transformResult: (raw: any, input: any) => ({
          symbol: input.symbol,
          candles: raw.bars?.[input.symbol] ?? [],
        }),
      },
      get_latest_bar: {
        method: 'get',
        path: (input: any) =>
          input.asset_type === 'crypto' ? '/v1beta3/crypto/us/latest/bars' : '/v2/stocks/bars/latest',
        makeParams: (input: any) => {
          if (!input.symbol) throw new Error('Symbol is required for get_latest_bar operation');
          const params: any = { symbols: input.symbol };
          if (input.asset_type !== 'crypto' && input.feed) params.feed = input.feed;
          if (input.currency) params.currency = input.currency;
          return params;
        },
        transformResult: (raw: any, input: any) => ({
          symbol: input.symbol,
          bar: raw.bars?.[input.symbol] ? [raw.bars[input.symbol]] : [],
        }),
      },
      place_order: {
        method: 'post',
        path: '/v2/orders',
        makeBody: (input: any) => {
          const {
            symbol,
            qty,
            notional,
            side,
            type,
            time_in_force,
            limit_price,
            stop_price,
            stop_limit_price,
            trail_percent,
            trail_price,
            extended_hours,
          } = input;

          if (!symbol) throw new Error('Symbol is required for place_order');
          if (!qty && !notional) throw new Error('Either qty or notional must be provided');

          const body: any = { symbol, side, type, time_in_force };

          if (type === 'limit') {
            if (!limit_price) throw new Error('Limit orders require a limit_price');
            body.limit_price = String(limit_price);
          } else if (type === 'stop') {
            if (!stop_price) throw new Error('Stop orders require a stop_price');
            body.stop_price = String(stop_price);
          } else if (type === 'stop_limit') {
            if (!stop_price || !stop_limit_price) {
              throw new Error('Stop limit orders require both stop_price and limit_price');
            }
            body.stop_price = String(stop_price);
            body.limit_price = String(stop_limit_price);
          } else if (type === 'trailing_stop') {
            if (!trail_percent && !trail_price) {
              throw new Error('Either trail percent or trail price must be provided');
            }
            if (trail_percent) body.trail_percent = String(trail_percent);
            else body.trail_price = String(trail_price);
          }

          if (notional) body.notional = String(notional);
          else body.qty = String(qty);

          if (extended_hours === 'true' || extended_hours === true) {
            body.extended_hours = true;
          }

          return body;
        },
      },
    },
  },

  // ============================================
  // DHAN
  // ============================================
  dhan: {
    authType: 'api_key',
    baseUrl: process.env.DHAN_API_BASE_URL || 'https://sandbox.dhan.co/v2',
    makeAuthHeaders: (creds: any) => ({
      'access-token': creds.api_key,
      'Content-Type': 'application/json',
    }),
    operations: {
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
      place_order: {
        method: 'post',
        path: '/orders',
        makeBody: async (input: any, creds: any) => {
          const {
            symbol,
            exchange_segment = 'NSE_EQ',
            transactionType = 'BUY',
            orderType = 'MARKET',
            productType = 'CNC',
            validity = 'DAY',
            quantity = 1,
            disclosedQuantity = 0,
            price = '',
            triggerPrice = '',
            afterMarketOrder = false,
            amoTime = '',
            boProfitValue = 0,
            boStopLossValue = 0,
            drvExpiryDate = '',
            drvOptionType = '',
            drvStrikePrice = 0,
          } = input;

          if (!symbol || !quantity || !transactionType) {
            throw new Error('Symbol, quantity, and transactionType are required for place_order');
          }

          const securityId = await lookupSecurityId(symbol, exchange_segment);
          if (!securityId) {
            throw new Error(
              `Security ID not found for symbol="${symbol}" segment="${exchange_segment}"`
            );
          }

          if (!creds.client_id) {
            throw new Error('Dhan client_id missing in credentials (required for order)');
          }

          const priceVal = orderType === 'LIMIT' ? String(price || '0') : '';
          const triggerPriceVal = ['STOP_LOSS', 'STOP_LOSS_MARKET', 'SL', 'SLM'].includes(
            orderType
          )
            ? String(triggerPrice || '0')
            : '';

          return {
            dhanClientId: creds.client_id,
            correlationId: uuidv4(),
            transactionType,
            exchangeSegment: exchange_segment,
            productType,
            orderType,
            validity,
            securityId,
            quantity,
            disclosedQuantity,
            price: priceVal,
            triggerPrice: triggerPriceVal,
            afterMarketOrder,
            amoTime,
            boProfitValue,
            boStopLossValue,
            drvExpiryDate,
            drvOptionType,
            drvStrikePrice,
          };
        },
      },
      get_candle: {
        method: 'post',
        path: '/charts/historical',
        makeBody: async (input: any) => {
          const {
            symbol,
            exchange_segment = 'NSE_EQ',
            from_date,
            to_date,
            lookback,
            timeframe = '1',
          } = input;

          if (!symbol) throw new Error('Symbol is required for get_candle');

          const securityId = await lookupSecurityId(symbol, exchange_segment);
          if (!securityId) {
            throw new Error(
              `Security ID not found for symbol="${symbol}" segment="${exchange_segment}"`
            );
          }

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
            oi: false,
          };
        },
        transformResult: (raw: any, input: any) => {
          const open = raw.open || [];
          const high = raw.high || [];
          const low = raw.low || [];
          const close = raw.close || [];
          const volume = raw.volume || [];
          const ts = raw.timestamp || [];

          let candles: any[] = [];

          if (
            Array.isArray(open) &&
            Array.isArray(high) &&
            Array.isArray(low) &&
            Array.isArray(close) &&
            Array.isArray(volume) &&
            Array.isArray(ts)
          ) {
            for (let i = 0; i < open.length; ++i) {
              candles.push({
                t: ts[i],
                o: open[i],
                h: high[i],
                l: low[i],
                c: close[i],
                v: volume[i],
              });
            }
          } else if (Array.isArray(raw.data)) {
            candles = raw.data.map((bar: any) => ({
              t: bar.timestamp || bar.t || bar.T,
              o: bar.open || bar.o || bar.O,
              h: bar.high || bar.h || bar.H,
              l: bar.low || bar.l || bar.L,
              c: bar.close || bar.c || bar.C,
              v: bar.volume || bar.v || bar.V,
            }));
          }

          return { symbol: input.symbol, candles };
        },
      },
    },
  },

  // ============================================
  // SCHWAB
  // ============================================
  schwab: {
    authType: 'oauth',
    baseUrl: (creds: any, input?: any) => {
      const marketDataOps = ['get_quotes', 'get_price_history'];
      if (input?.operation && marketDataOps.includes(input.operation)) {
        return 'https://api.schwabapi.com/marketdata/v1';
      }
      return 'https://api.schwabapi.com/trader/v1';
    },
    makeAuthHeaders: async (creds: any) => {
      const refreshedCreds = await refreshSchwabTokenIfNeeded(creds);
      return {
        Authorization: `Bearer ${refreshedCreds.access_token}`,
      };
    },
    operations: {
      get_account_numbers: {
        method: 'get',
        path: '/accounts/accountNumbers',
        transformResult: (raw: any) => {
          if (!raw || !Array.isArray(raw)) return { accounts: [] };
          return {
            accounts: raw.map((acc: any) => ({
              id: acc.hashValue,
              name: `Account ${acc.accountNumber}`,
              accountNumber: acc.accountNumber,
              hashValue: acc.hashValue,
            })),
          };
        },
      },
      get_account: {
        method: 'get',
        path: (input: any) => {
          const accountHash = input.accountHash || input.account_hash;
          if (!accountHash) throw new Error('accountHash is required. Please select an account.');
          return `/accounts/${accountHash}`;
        },
        makeParams: (input: any) => ({
          fields: input.fields || 'positions',
        }),
      },
      get_positions: {
        method: 'get',
        path: (input: any) => {
          const accountHash = input.accountHash || input.account_hash;
          if (!accountHash) throw new Error('accountHash is required. Please select an account.');
          return `/accounts/${accountHash}`;
        },
        makeParams: () => ({
          fields: 'positions',
        }),
      },
      get_orders: {
        method: 'get',
        path: (input: any) => {
          const accountHash = input.accountHash || input.account_hash;
          if (!accountHash) throw new Error('accountHash is required. Please select an account.');
          return `/accounts/${accountHash}/orders`;
        },
        makeParams: (input: any) => ({
          maxResults: input.limit || 100,
          fromEnteredTime: input.start_date,
          toEnteredTime: input.end_date,
          status: input.status || 'FILLED,CANCELED,REJECTED',
        }),
      },
      place_order: {
        method: 'post',
        path: (input: any) => {
          const accountHash = input.accountHash || input.account_hash;
          if (!accountHash) throw new Error('accountHash is required. Please select an account.');
          return `/accounts/${accountHash}/orders`;
        },
        makeBody: (input: any) => {
          const {
            symbol,
            instruction = 'BUY',
            quantity,
            orderType = 'MARKET',
            price,
            duration = 'DAY',
            session = 'NORMAL',
          } = input;

          if (!symbol) throw new Error('symbol is required for place_order');
          if (!quantity || quantity <= 0) throw new Error('quantity must be greater than 0');

          const orderPayload: any = {
            orderType: orderType.toUpperCase(),
            session: session.toUpperCase(),
            duration: duration.toUpperCase(),
            orderStrategyType: 'SINGLE',
            orderLegCollection: [
              {
                instruction: instruction.toUpperCase(),
                quantity: Number(quantity),
                instrument: {
                  symbol: symbol.toUpperCase(),
                  assetType: 'EQUITY',
                },
              },
            ],
          };

          if ((orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && price) {
            orderPayload.price = Number(price);
          }

          return orderPayload;
        },
        transformResult: (raw: any) => ({
          success: true,
          message: 'Order placed successfully',
          orderId: raw.orderId || 'Order submitted',
        }),
      },
      cancel_order: {
        method: 'delete',
        path: (input: any) => {
          const accountHash = input.accountHash || input.account_hash;
          if (!accountHash) throw new Error('accountHash is required. Please select an account.');
          if (!input.order_id) throw new Error('order_id is required for cancel_order');
          return `/accounts/${accountHash}/orders/${input.order_id}`;
        },
      },
      get_quotes: {
        method: 'get',
        path: '/quotes',
        makeParams: (input: any) => {
          if (!input.symbols) throw new Error('symbols parameter is required for get_quotes');
          return {
            symbols: input.symbols,
            fields: input.fields || 'quote,fundamental',
            indicative: 'false',
          };
        },
        transformResult: (raw: any) => {
          const quotes = Object.entries(raw).map(([symbol, data]: [string, any]) => ({
            symbol,
            ...(data.quote || {}),
            fundamental: data.fundamental,
            reference: data.reference,
          }));
          return { quotes, count: quotes.length };
        },
      },
      get_price_history: {
        method: 'get',
        path: '/pricehistory',
        makeParams: (input: any) => {
          if (!input.symbol) throw new Error('symbol parameter is required for get_price_history');
          return {
            symbol: input.symbol,
            periodType: input.periodType || 'day',
            period: input.period || '10',
            frequencyType: input.frequencyType || 'minute',
            frequency: input.frequency || '1',
            needExtendedHoursData: input.needExtendedHoursData || 'false',
          };
        },
        transformResult: (raw: any) => ({
          symbol: raw.symbol,
          candles: raw.candles || [],
          empty: raw.empty || false,
        }),
      },
    },
  },

  // ============================================
  // BINANCE (placeholder - add operations as needed)
  // ============================================
  binance: {
    authType: 'api_key',
    baseUrl: (creds: any, input?: any) =>
      input?.environment === 'testnet'
        ? 'https://testnet.binance.vision'
        : 'https://api.binance.com',
    makeAuthHeaders: (creds: any) => ({
      'X-MBX-APIKEY': creds.api_key,
    }),
    operations: {
      get_account: {
        method: 'get',
        path: '/api/v3/account',
      },
    },
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

export function isSupportedBroker(broker: string): boolean {
  return broker.toLowerCase() in BROKER_CONFIGS;
}

export function getBrokerConfig(broker: string): BrokerConfig | undefined {
  return BROKER_CONFIGS[broker.toLowerCase()];
}

export function getAllSupportedBrokers(): string[] {
  return Object.keys(BROKER_CONFIGS);
}
