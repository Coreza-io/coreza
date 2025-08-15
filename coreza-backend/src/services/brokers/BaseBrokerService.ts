import { supabase } from '../../config/supabase';
import { IBrokerService, BrokerInput, BrokerResult } from './types';
import DecryptionUtil from '../../utils/decryption';

export abstract class BaseBrokerService implements IBrokerService {
  abstract readonly brokerKey: string;
  /** Map from operation → handler(input) */
  protected abstract handlers: Record<string, (input: BrokerInput) => Promise<any>>;

  async execute(input: BrokerInput): Promise<BrokerResult> {
    const handler = this.handlers[input.operation];
    if (!handler) {
      return {
        success: false,
        error: `Unsupported operation: ${input.operation} for broker: ${this.brokerKey}`
      };
    }

    try {
      const data = await handler.call(this, input);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  protected async getCredentials(userId: string, credentialId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('user_credentials')
        .select('client_json, token_json')
        .eq('user_id', userId)
        .eq('name', credentialId)
        .eq('service_type', this.brokerKey)
        .single();

      if (error) {
        return { credentials: null };
      }

      if (!data) {
        return { credentials: null };
      }

      // Decrypt credentials before returning
      const decryptedClientJson = { ...data.client_json };
      const decryptedTokenJson = { ...data.token_json };

      try {
        // Decrypt sensitive fields if they appear to be encrypted
        if (decryptedClientJson.api_key && DecryptionUtil.isEncrypted(decryptedClientJson.api_key)) {
          decryptedClientJson.api_key = await DecryptionUtil.decrypt(decryptedClientJson.api_key);
        }
        
        if (decryptedTokenJson.secret_key && DecryptionUtil.isEncrypted(decryptedTokenJson.secret_key)) {
          decryptedTokenJson.secret_key = await DecryptionUtil.decrypt(decryptedTokenJson.secret_key);
        }
      } catch (decryptError) {
        console.error(`Error decrypting ${this.brokerKey} credentials:`, decryptError);
        throw new Error(`Failed to decrypt ${this.brokerKey} credentials`);
      }

      return { 
        credentials: { 
          client_json: decryptedClientJson, 
          token_json: decryptedTokenJson 
        } 
      };
    } catch (error) {
      throw new Error(`Failed to get ${this.brokerKey} credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}