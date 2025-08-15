import { supabase } from '../../config/supabase';
import { IBrokerService, BrokerInput, BrokerResult } from './types';
import DecryptionUtil from '../../utils/decryption';
import { CredentialValidator } from '../../utils/credentialValidator';

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
        // Decrypt all sensitive fields if they appear to be encrypted
        const sensitiveFields = ['api_key', 'secret_key', 'access_token', 'refresh_token', 'client_secret'];
        
        for (const field of sensitiveFields) {
          if (decryptedClientJson[field] && DecryptionUtil.isEncrypted(decryptedClientJson[field])) {
            decryptedClientJson[field] = await DecryptionUtil.decrypt(decryptedClientJson[field]);
          }
          
          if (decryptedTokenJson[field] && DecryptionUtil.isEncrypted(decryptedTokenJson[field])) {
            decryptedTokenJson[field] = await DecryptionUtil.decrypt(decryptedTokenJson[field]);
          }
        }
        
        // Validate decrypted credentials
        const combinedCredentials = { ...decryptedClientJson, ...decryptedTokenJson };
        const validation = CredentialValidator.validateCredentials(this.brokerKey, combinedCredentials);
        
        if (!validation.isValid) {
          console.error(`Invalid ${this.brokerKey} credentials:`, validation.errors);
          throw new Error(`Invalid ${this.brokerKey} credentials: ${validation.errors.join(', ')}`);
        }
        
        if (validation.warnings.length > 0) {
          console.warn(`${this.brokerKey} credential warnings:`, validation.warnings);
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