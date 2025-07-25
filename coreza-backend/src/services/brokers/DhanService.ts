import axios from 'axios';
import fs from 'fs';
import csv from 'csv-parser';
import path from 'path';
import { BaseBrokerService } from './BaseBrokerService';
import { BrokerInput } from './types';

export class DhanService extends BaseBrokerService {
  readonly brokerKey = 'dhan';
  private scripMasterCache: Map<string, string> | null = null;

  protected handlers = {
    get_account: async (input: BrokerInput) => {
      return this.request('/funds', input);
    },

    get_positions: async (input: BrokerInput) => {
      return this.request('/positions', input);
    },

    get_holdings: async (input: BrokerInput) => {
      return this.request('/holdings', input);
    },

    get_orders: async (input: BrokerInput) => {
      return this.request('/orders', input);
    },

    get_candle: async (input: BrokerInput) => {
      return this.getHistoricalBars(input);
    },
  };

  private async request(path: string, { user_id, credential_id }: BrokerInput) {
    const { api_key } = await this.getCredentials(user_id, credential_id);
    const response = await axios.get(`https://sandbox.dhan.co/v2${path}`, {
      headers: {
        'access-token': api_key,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  }

  private async getHistoricalBars(input: BrokerInput) {
    const { api_key } = await this.getCredentials(input.user_id, input.credential_id);
    const { symbol, exchange_segment = 'NSE_EQ', from_date, to_date, timeframe = '1' } = input;

    if (!symbol) throw new Error('Symbol is required for get_candle operation');

    // Get security ID from symbol
    const securityId = await this.lookupSecurityId(symbol, exchange_segment);
    if (!securityId) throw new Error(`Security ID not found for symbol: ${symbol}`);

    const headers = {
      'access-token': api_key,
      'Content-Type': 'application/json',
    };

    const requestBody = {
      securityId,
      exchangeSegment: exchange_segment,
      instrument: 'EQUITY',
      fromDate: from_date,
      toDate: to_date,
    };

    const response = await axios.post('https://sandbox.dhan.co/v2/charts/historical', requestBody, { headers });

    // Transform the data to match expected format
    if (response.data && response.data.data) {
      return response.data.data.map((bar: any) => ({
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      }));
    }

    return response.data;
  }

  private async loadScripMaster(): Promise<Map<string, string>> {
    if (this.scripMasterCache) return this.scripMasterCache;

    this.scripMasterCache = new Map<string, string>();
    const csvFilePath = path.join(__dirname, '../../../data/dhan_scrip_master.csv');

    if (!fs.existsSync(csvFilePath)) {
      console.warn('Dhan scrip master CSV file not found. Using fallback lookup.');
      return this.scripMasterCache;
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
            this.scripMasterCache!.set(key, securityId);
          }
        })
        .on('end', () => {
          console.log(`Loaded ${this.scripMasterCache!.size} entries from Dhan scrip master`);
          resolve(this.scripMasterCache!);
        })
        .on('error', reject);
    });
  }

  private async lookupSecurityId(symbol: string, exchangeSegment: string): Promise<string> {
    const scripMaster = await this.loadScripMaster();
    const key = `${symbol}_${exchangeSegment}`;
    return scripMaster.get(key) || '';
  }
}