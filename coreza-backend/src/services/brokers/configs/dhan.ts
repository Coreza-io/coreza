import fs from 'fs';
import * as csv from 'csv-parser';
import path from 'path';
import { RestConfig } from '../RestBrokerService';
import { BrokerInput } from '../types';

// Cache for scrip master data
let scripMasterCache: Map<string, string> | null = null;

async function loadScripMaster(): Promise<Map<string, string>> {
  if (scripMasterCache) return scripMasterCache;

  scripMasterCache = new Map<string, string>();
  const csvFilePath = path.join(__dirname, '../../../../data/dhan_scrip_master.csv');

  if (!fs.existsSync(csvFilePath)) {
    console.warn('Dhan scrip master CSV file not found. Using fallback lookup.');
    return scripMasterCache;
  }

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const symbol = row['SEM_TRADING_SYMBOL']?.trim();
        const securityId = row['SEM_SMST_SECURITY_ID']?.trim();
        const exchangeSegment = row['SEM_EXM_EXCH_ID']?.trim();

        if (symbol && securityId && exchangeSegment) {
          const key = `${symbol}_${exchangeSegment}`;
          scripMasterCache!.set(key, securityId);
        }
      })
      .on('end', () => {
        console.log(`Loaded ${scripMasterCache!.size} entries from Dhan scrip master`);
        resolve(scripMasterCache!);
      })
      .on('error', reject);
  });
}

async function lookupSecurityId(symbol: string, exchangeSegment: string): Promise<string> {
  const scripMaster = await loadScripMaster();
  const key = `${symbol}_${exchangeSegment}`;
  return scripMaster.get(key) || '';
}

export const dhanConfig: RestConfig = {
  baseUrl: 'https://sandbox.dhan.co/v2',
  
  makeAuthHeaders: (creds: any) => ({
    'access-token': creds.api_key,
    'Content-Type': 'application/json',
  }),
  
  ops: {
    get_account: { 
      method: 'get', 
      path: '/funds' 
    },
    
    get_positions: { 
      method: 'get', 
      path: '/positions' 
    },
    
    get_holdings: { 
      method: 'get', 
      path: '/holdings' 
    },
    
    get_orders: { 
      method: 'get', 
      path: '/orders' 
    },
    
    get_candle: {
      method: 'post', 
      path: '/charts/historical',
      makeBody: async (input: BrokerInput) => {
        const { symbol, exchange_segment = 'NSE_EQ', from_date, to_date, timeframe = '1' } = input;
        
        if (!symbol) {
          throw new Error('Symbol is required for get_candle operation');
        }

        // Get security ID from symbol
        const securityId = await lookupSecurityId(symbol, exchange_segment);
        if (!securityId) {
          throw new Error(`Security ID not found for symbol: ${symbol}`);
        }

        return {
          securityId,
          exchangeSegment: exchange_segment,
          instrument: 'EQUITY',
          fromDate: from_date,
          toDate: to_date,
        };
      }
    }
  }
};