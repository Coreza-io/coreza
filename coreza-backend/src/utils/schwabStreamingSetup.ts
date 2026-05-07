/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import axios from 'axios';

/**
 * Schwab Streaming Setup Utility
 * 
 * Fetches streaming configuration from Schwab userPreference API
 * Schwab requires OAuth authentication to get dynamic streaming URLs
 */

export interface SchwabStreamerInfo {
  streamerSocketUrl: string;
  schwabClientCustomerId: string;
  schwabClientCorrelId: string;
  schwabClientChannel: string;
  schwabClientFunctionId: string;
}

export interface SchwabStreamingCredentials {
  access_token: string;
  streamerSocketUrl: string;
  schwabClientCustomerId: string;
  schwabClientCorrelId: string;
  schwabClientChannel: string;
  schwabClientFunctionId: string;
}

/**
 * Fetch Schwab streaming configuration
 * Must be called before connecting to WebSocket
 */
export async function fetchSchwabStreamingConfig(
  accessToken: string
): Promise<SchwabStreamingCredentials> {
  try {
    console.log('[Schwab Setup] Fetching streaming configuration...');
    
    const response = await axios.get(
      'https://api.schwabapi.com/trader/v1/userPreference',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );
    
    const streamerInfo = response.data?.streamerInfo?.[0];
    if (!streamerInfo) {
      throw new Error('Streamer info not found in userPreference response');
    }
    
    // Extract streaming URL and credentials
    const config: SchwabStreamingCredentials = {
      access_token: accessToken,
      streamerSocketUrl: streamerInfo.streamerSocketUrl,
      schwabClientCustomerId: streamerInfo.schwabClientCustomerId,
      schwabClientCorrelId: streamerInfo.schwabClientCorrelId,
      schwabClientChannel: streamerInfo.schwabClientChannel || 'client',
      schwabClientFunctionId: streamerInfo.schwabClientFunctionId || 'stream',
    };
    
    console.log('[Schwab Setup] Streaming config fetched:', {
      url: config.streamerSocketUrl,
      customerId: config.schwabClientCustomerId,
    });
    
    return config;
  } catch (error: any) {
    console.error('[Schwab Setup] Failed to fetch streaming config:', error.message);
    throw new Error(
      `Failed to fetch Schwab streaming configuration: ${error.message}`
    );
  }
}

/**
 * Build Schwab login request message
 * This must be sent immediately after WebSocket connection
 */
export function buildSchwabLoginMessage(
  credentials: SchwabStreamingCredentials
): any {
  return {
    requests: [
      {
        requestid: '0',
        service: 'ADMIN',
        command: 'LOGIN',
        SchwabClientCustomerId: credentials.schwabClientCustomerId,
        SchwabClientCorrelId: credentials.schwabClientCorrelId,
        parameters: {
          Authorization: credentials.access_token,
          SchwabClientChannel: credentials.schwabClientChannel,
          SchwabClientFunctionId: credentials.schwabClientFunctionId,
        },
      },
    ],
  };
}

/**
 * Parse Schwab streaming response
 * Schwab wraps data in nested response/data/content structure
 */
export function parseSchwabStreamingMessage(data: any): any[] {
  try {
    // Response structure:
    // { response: [{ service: "LEVELONE_EQUITIES", content: [{...}] }] }
    if (data.response && Array.isArray(data.response)) {
      return data.response;
    }
    
    // Sometimes data arrives directly
    if (data.data && Array.isArray(data.data)) {
      return data.data;
    }
    
    // Single message
    return [data];
  } catch (error) {
    console.error('[Schwab Parser] Parse error:', error);
    return [data];
  }
}

/**
 * Map Schwab field indices to readable names
 * Schwab uses numeric field indices instead of field names
 */
export const SCHWAB_FIELD_MAP: Record<number, string> = {
  0: 'symbol',
  1: 'bidPrice',
  2: 'askPrice',
  3: 'lastPrice',
  4: 'bidSize',
  5: 'askSize',
  6: 'askId',
  7: 'bidId',
  8: 'totalVolume',
  9: 'lastSize',
  10: 'tradeTime',
  11: 'quoteTime',
  12: 'highPrice',
  13: 'lowPrice',
  14: 'bidTick',
  15: 'closePrice',
  16: 'exchangeId',
  17: 'marginable',
  18: 'shortable',
  19: 'islandBid',
  20: 'islandAsk',
  21: 'islandVolume',
  22: 'quoteDay',
  23: 'tradeDay',
  24: 'volatility',
  25: 'description',
  26: 'lastId',
  27: 'digits',
  28: 'openPrice',
  29: 'netChange',
  30: 'highPrice52Week',
  31: 'lowPrice52Week',
  32: 'peRatio',
  33: 'dividendAmount',
  34: 'dividendYield',
  35: 'islandBidSize',
  36: 'islandAskSize',
  37: 'nav',
  38: 'fundPrice',
  39: 'exchangeName',
  40: 'dividendDate',
  41: 'regularMarketQuote',
  42: 'regularMarketTrade',
  43: 'regularMarketLastPrice',
  44: 'regularMarketLastSize',
  45: 'regularMarketTradeTime',
  46: 'regularMarketTradeDay',
  47: 'regularMarketNetChange',
  48: 'securityStatus',
  49: 'mark',
  50: 'quoteTimeInLong',
  51: 'tradeTimeInLong',
  52: 'regularMarketTradeTimeInLong',
};
