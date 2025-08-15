import { supabase } from '../config/supabase';
import EncryptionUtil from '../utils/encryption';

export interface UserCredential {
  id: string;
  user_id: string;
  service_type: string;
  name: string;
  client_json: Record<string, any>;
  token_json: Record<string, any>;
  scopes?: string;
  created_at: string;
  updated_at: string;
}

export interface AlpacaCredentials {
  api_key: string;
  secret_key: string;
  paper_trading: boolean;
}

export class CredentialManager {
  /**
   * Store user credentials for a service (encrypts before storing)
   */
  static async storeCredentials(
    userId: string,
    serviceType: string,
    name: string,
    credentials: AlpacaCredentials,
    scopes?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Encrypt sensitive credentials
      const encryptedClientJson = {
        api_key: EncryptionUtil.encrypt(credentials.api_key, userId),
        paper_trading: credentials.paper_trading // This is not sensitive
      };

      const encryptedTokenJson = {
        secret_key: EncryptionUtil.encrypt(credentials.secret_key, userId)
      };

      const { data, error } = await supabase
        .from('user_credentials')
        .upsert({
          user_id: userId,
          service_type: serviceType,
          name: name,
          client_json: encryptedClientJson,
          token_json: encryptedTokenJson,
          scopes: scopes || null
        }, {
          onConflict: 'user_id,service_type,name'
        })
        .select()
        .single();

      if (error) {
        console.error('Error storing credentials:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('Unexpected error storing credentials:', err);
      return { success: false, error: 'Failed to store credentials' };
    }
  }

  /**
   * Retrieve user credentials for a service (decrypts after retrieving)
   */
  static async getCredentials(
    userId: string,
    serviceType: string,
    name?: string
  ): Promise<{ credentials?: AlpacaCredentials; error?: string }> {
    try {
      let query = supabase
        .from('user_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('service_type', serviceType);

      if (name) {
        query = query.eq('name', name);
      }

      const { data, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          return { error: 'Credentials not found' };
        }
        console.error('Error retrieving credentials:', error);
        return { error: error.message };
      }

      // Decrypt sensitive credentials
      const credentials: AlpacaCredentials = {
        api_key: EncryptionUtil.decrypt(data.client_json.api_key, userId),
        secret_key: EncryptionUtil.decrypt(data.token_json.secret_key, userId),
        paper_trading: data.client_json.paper_trading || true
      };

      return { credentials };
    } catch (err) {
      console.error('Unexpected error retrieving credentials:', err);
      return { error: 'Failed to retrieve credentials' };
    }
  }

  /**
   * List all credentials for a user
   */
  static async listUserCredentials(
    userId: string,
    serviceType?: string
  ): Promise<{ credentials: UserCredential[]; error?: string }> {
    try {
      let query = supabase
        .from('user_credentials')
        .select('id, user_id, service_type, name, scopes, created_at, updated_at')
        .eq('user_id', userId);

      if (serviceType) {
        query = query.eq('service_type', serviceType);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Error listing credentials:', error);
        return { credentials: [], error: error.message };
      }

      return { credentials: data || [] };
    } catch (err) {
      console.error('Unexpected error listing credentials:', err);
      return { credentials: [], error: 'Failed to list credentials' };
    }
  }

  /**
   * Delete user credentials
   */
  static async deleteCredentials(
    userId: string,
    serviceType: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('user_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('service_type', serviceType)
        .eq('name', name);

      if (error) {
        console.error('Error deleting credentials:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      console.error('Unexpected error deleting credentials:', err);
      return { success: false, error: 'Failed to delete credentials' };
    }
  }

  /**
   * Validate Alpaca credentials by making a test API call
   */
  static async validateAlpacaCredentials(
    credentials: AlpacaCredentials
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const { ALPACA_CONFIG } = await import('../config/supabase');
      const baseUrl = credentials.paper_trading ? ALPACA_CONFIG.PAPER_URL : 'https://api.alpaca.markets';
      
      const response = await fetch(`${baseUrl}/v2/account`, {
        headers: {
          'APCA-API-KEY-ID': credentials.api_key,
          'APCA-API-SECRET-KEY': credentials.secret_key
        }
      });

      if (response.ok) {
        return { valid: true };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return { 
          valid: false, 
          error: errorData.message || `API call failed with status ${response.status}` 
        };
      }
    } catch (err) {
      console.error('Error validating Alpaca credentials:', err);
      return { 
        valid: false, 
        error: 'Failed to validate credentials' 
      };
    }
  }
}

export default CredentialManager;