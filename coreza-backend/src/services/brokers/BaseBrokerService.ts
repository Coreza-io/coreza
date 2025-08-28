import { supabase } from '../../config/supabase';
import { IBrokerService, BrokerInput, BrokerResult } from './types';
import DecryptionUtil from '../../utils/decryption';
import EnvelopeEncryptionUtil from '../../utils/envelopeEncryption';
import CredentialManager from '../../utils/credentialManager';
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
        .select('*')
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

      let decryptedCredentials: any = {};

      if (data.is_encrypted) {
        // Check for new frontend encryption format (enc_version: 2, key_ref: 'user:v2')
        if (data.enc_version === 2 && data.key_ref === 'user:v2') {
          console.log(`🔓 Decrypting frontend credentials for broker ${this.brokerKey}`);
          
          // Use CredentialManager for frontend-encrypted data
          const result = await CredentialManager.getDecryptedCredentials(userId, this.brokerKey, data.name);
          if (result.error) {
            throw new Error(`Failed to get ${this.brokerKey} credentials: ${result.error}`);
          }
          decryptedCredentials = result.credentials;
          
        } else if (data.enc_payload) {
          // Legacy envelope encryption path
          console.log(`🔓 Decrypting envelope credentials for broker ${this.brokerKey}`);
          
          const decryptionInput = {
            encPayload: data.enc_payload,
            iv: data.iv,
            authTag: data.auth_tag,
            dekWrapped: data.dek_wrapped,
            keyRef: data.key_ref || 'env:v1',
            userId,
            credentialId: data.id
          };

          const payload = EnvelopeEncryptionUtil.decrypt(decryptionInput);
          decryptedCredentials = { ...payload.client, ...payload.token };
        }

      } else {
        // Legacy decryption path for backward compatibility
        console.log(`🔓 Decrypting legacy credentials for broker ${this.brokerKey}`);
        
        const decryptedClientJson = { ...data.client_json };
        const decryptedTokenJson = { ...data.token_json };

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

        decryptedCredentials = { ...decryptedClientJson, ...decryptedTokenJson };
      }

      // Validate decrypted credentials
      const validation = CredentialValidator.validateCredentials(this.brokerKey, decryptedCredentials);
      
      if (!validation.isValid) {
        console.error(`Invalid ${this.brokerKey} credentials:`, validation.errors);
        throw new Error(`Invalid ${this.brokerKey} credentials: ${validation.errors.join(', ')}`);
      }
      
      if (validation.warnings.length > 0) {
        console.warn(`${this.brokerKey} credential warnings:`, validation.warnings);
      }

      return { 
        credentials: { 
          client_json: decryptedCredentials, 
          token_json: {} 
        } 
      };
    } catch (error) {
      throw new Error(`Failed to get ${this.brokerKey} credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}