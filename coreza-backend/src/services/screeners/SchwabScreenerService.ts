import { BaseScreenerService } from './BaseScreenerService';
import { ScreenerInput, IScreenerService } from './types';
import axios from 'axios';

export class SchwabScreenerService 
  extends BaseScreenerService 
  implements IScreenerService 
{
  readonly screenerKey = 'schwab';

  private readonly baseUrl = 'https://api.schwabapi.com/marketdata/v1';

  protected handlers: Record<string, (input: ScreenerInput) => Promise<any>> = {
    // Get market movers (gainers/losers)
    movers: async (input: ScreenerInput) => {
      const creds = await this.getCredentialsWithRefresh(input.user_id, input.credential_id!);
      const index = input.index || '$DJI';
      const direction = input.direction || 'up';
      const change = input.change || 'percent';
      
      const response = await axios.get(
        `${this.baseUrl}/movers/${index}`,
        {
          params: { direction, change },
          headers: { Authorization: `Bearer ${creds.access_token}` }
        }
      );

      return {
        movers: response.data.screener || [],
        count: response.data.screener?.length || 0,
        index,
        direction,
        source: 'schwab_movers'
      };
    },

    // Get fundamental data for symbols
    get_fundamentals: async (input: ScreenerInput) => {
      const creds = await this.getCredentialsWithRefresh(input.user_id, input.credential_id!);
      
      let symbols = input.symbols;
      
      // Handle different input formats
      if (Array.isArray(symbols)) {
        symbols = symbols.map(s => typeof s === 'string' ? s : s.symbol).join(',');
      } else if (typeof symbols === 'object' && symbols !== null) {
        // Extract symbols from array of objects
        symbols = Object.values(symbols).map((s: any) => s.symbol).join(',');
      }
      
      if (!symbols || symbols.length === 0) {
        throw new Error('symbols parameter is required');
      }

      const fields = input.fields || 'quote,fundamental,reference';
      
      const response = await axios.get(
        `${this.baseUrl}/quotes`,
        {
          params: { symbols, fields, indicative: 'false' },
          headers: { Authorization: `Bearer ${creds.access_token}` }
        }
      );

      // Transform Schwab's object format to array
      const quotes = Object.entries(response.data).map(([symbol, data]: [string, any]) => {
        const quote = data.quote || {};
        const fundamental = data.fundamental || {};
        const reference = data.reference || {};
        
        return {
          symbol,
          // Quote data
          lastPrice: quote.lastPrice,
          bidPrice: quote.bidPrice,
          askPrice: quote.askPrice,
          netChange: quote.netChange,
          netPercentChange: quote.netPercentChange,
          totalVolume: quote.totalVolume,
          
          // Fundamental data
          marketCap: fundamental.marketCap,
          marketCapBillions: fundamental.marketCap ? fundamental.marketCap / 1e9 : 0,
          peRatio: fundamental.peRatio,
          pegRatio: fundamental.pegRatio,
          pbRatio: fundamental.pbRatio,
          dividendYield: fundamental.divYield,
          dividendAmount: fundamental.divAmount,
          dividendDate: fundamental.divDate,
          eps: fundamental.eps,
          high52: fundamental.high52,
          low52: fundamental.low52,
          
          // Reference data
          description: reference.description,
          exchange: reference.exchange,
          exchangeName: reference.exchangeName,
          assetMainType: reference.assetMainType,
          cusip: reference.cusip
        };
      });

      return {
        quotes,
        count: quotes.length,
        source: 'schwab_fundamentals'
      };
    },

    // Search instruments
    get_instruments: async (input: ScreenerInput) => {
      const creds = await this.getCredentialsWithRefresh(input.user_id, input.credential_id!);
      const symbol = input.symbol;
      const projection = input.projection || 'symbol-search';
      
      if (!symbol) {
        throw new Error('symbol parameter is required');
      }

      const response = await axios.get(
        `${this.baseUrl}/instruments`,
        {
          params: { symbol, projection },
          headers: { Authorization: `Bearer ${creds.access_token}` }
        }
      );

      return {
        instruments: response.data.instruments || [],
        count: response.data.instruments?.length || 0,
        source: 'schwab_instruments'
      };
    },

    // Get single instrument by CUSIP
    get_instrument_cusip: async (input: ScreenerInput) => {
      const creds = await this.getCredentialsWithRefresh(input.user_id, input.credential_id!);
      const cusip = input.cusip;
      
      if (!cusip) {
        throw new Error('cusip parameter is required');
      }

      const response = await axios.get(
        `${this.baseUrl}/instruments/${cusip}`,
        {
          headers: { Authorization: `Bearer ${creds.access_token}` }
        }
      );

      return {
        instruments: response.data.instruments || [],
        count: 1,
        source: 'schwab_instruments'
      };
    }
  };

  /**
   * Get credentials with automatic token refresh
   * Checks if access token is expired and refreshes it before returning
   */
  private async getCredentialsWithRefresh(userId: string, credentialId: string): Promise<any> {
    const result = await this.getCredentials(userId, credentialId);
    const creds = result.credentials?.client_json;

    if (!creds) {
      throw new Error('Credentials not found');
    }

    // Check if access token is expired (refresh 1 minute before expiry)
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = creds.token_expires_at || 0;

    if (now >= expiresAt - 60) {
      console.log('🔄 [SCHWAB] Access token expired, refreshing...');

      try {
        // Create Basic Auth header
        const credentials = `${creds.app_key}:${creds.app_secret}`;
        const encodedCredentials = Buffer.from(credentials).toString('base64');

        // Refresh the token
        const response = await axios.post(
          'https://api.schwabapi.com/v1/oauth/token',
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: creds.refresh_token
          }),
          {
            headers: {
              'Authorization': `Basic ${encodedCredentials}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );

        const newTokens = response.data;
        const newExpiresAt = now + newTokens.expires_in;

        console.log('✅ [SCHWAB] Token refreshed successfully');

        // Update stored credentials with new access token
        // We need to get the credential record to update it
        const { data: credentialRecord } = await (await import('../config/supabase')).supabase
          .from('user_credentials')
          .select('*')
          .eq('user_id', userId)
          .eq('name', credentialId)
          .eq('service_type', this.screenerKey)
          .single();

        if (credentialRecord) {
          const EnvelopeEncryptionUtil = (await import('../../utils/envelopeEncryption')).default;
          
          const payload = {
            service_type: this.screenerKey,
            name: credentialId,
            client: {
              app_key: creds.app_key,
              app_secret: creds.app_secret
            },
            token: {
              access_token: newTokens.access_token,
              refresh_token: creds.refresh_token,
              token_expires_at: newExpiresAt
            },
            meta: {
              last_token_refresh: new Date().toISOString()
            }
          };

          const encrypted = EnvelopeEncryptionUtil.encrypt(payload, userId);

          await (await import('../config/supabase')).supabase
            .from('user_credentials')
            .update({
              enc_payload: encrypted.encPayload,
              iv: encrypted.iv,
              auth_tag: encrypted.authTag,
              dek_wrapped: encrypted.dekWrapped,
              updated_at: new Date().toISOString()
            })
            .eq('id', credentialRecord.id)
            .eq('user_id', userId);
        }

        // Return credentials with new access token
        return {
          ...creds,
          access_token: newTokens.access_token,
          token_expires_at: newExpiresAt
        };
      } catch (refreshError: any) {
        console.error('❌ [SCHWAB] Token refresh failed:', refreshError);
        throw new Error(`Token refresh failed: ${refreshError.message}. Please re-authenticate your Schwab account.`);
      }
    }

    return creds;
  }
}
