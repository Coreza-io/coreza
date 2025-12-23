import { BrokerOperation } from '../types';
import { buildDhanHistoricalBody, buildDhanPlaceOrder, transformDhanCandles } from './helpers';

export const dhanOperations: Record<string, BrokerOperation> = {
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
    makeBody: (input: any, creds: any) => buildDhanPlaceOrder(input, creds),
  },
  get_candle: {
    method: 'post',
    path: '/charts/historical',
    makeBody: (input: any) => buildDhanHistoricalBody(input),
    transformResult: (raw: any, input: any) => transformDhanCandles(raw, input),
  },
};
