/**
 * Enhanced Credential Manager with envelope encryption support
 * Provides dual-read capability and secure migration path
 */

import { supabase } from '../config/supabase';
import EnvelopeEncryptionUtil from './envelopeEncryption';
import DecryptionUtil from './decryption';
import { CredentialValidator } from './credentialValidator';
// Security monitoring integrated directly

export interface UserCredential {
  id: string;
  name: string;
  service_type: string;
  created_at: string;
  updated_at: string;
  is_encrypted: boolean;
  enc_version?: number;
  key_ref?: string;
}

export interface DecryptedCredential extends UserCredential {
  credentials: Record<string, any>;
}

export interface CredentialPayload {
  service_type: string;
  name: string;
  client: Record<string, any>;
  token: Record<string, any>;
  scopes?: string;
  meta?: {
    migrated_from_plaintext?: boolean;
    migrated_at?: string;
    created_with_envelope?: boolean;
  };
}

class CredentialManager {
  /**
   * Get decrypted credentials for backend API calls only
   * Frontend stores credentials directly via Supabase client
   */
  static async getDecryptedCredentials(
    userId: string,
    serviceType: string,
    credentialName?: string
  ): Promise<{ credentials?: any; error?: string }> {
    try {
      // Fetch encrypted credentials from database
      let query = supabase
        .from('user_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('service_type', serviceType);

      if (credentialName) {
        query = query.eq('name', credentialName);
      }

      const { data, error } = await query;
      if (error) {
        return { error: `Failed to fetch credentials: ${error.message}` };
      }

      if (!data || data.length === 0) {
        return { error: 'Credentials not found' };
      }

      const credential = data[0];
      
      // Try client_json field first (frontend encrypted with simple AES-GCM)
      if (credential.client_json && typeof credential.client_json === 'string') {
        try {
          // Frontend uses simple base64 encoded encrypted data (iv + encrypted)
          const encryptionKey = process.env.COREZA_ENCRYPTION_KEY;
          if (!encryptionKey) {
            throw new Error('Encryption key not available');
          }
          
          const decryptedCredentials = await this.decryptClientData(credential.client_json, encryptionKey);
          return { credentials: decryptedCredentials };
        } catch (decryptError) {
          console.error('Failed to decrypt client_json:', decryptError);
          return { error: 'Failed to decrypt credentials' };
        }
      }

      // Handle new frontend encryption format (enc_version: 2, key_ref: 'user:v2')
      if (credential.is_encrypted && credential.enc_version === 2 && credential.key_ref === 'user:v2') {
        try {
          // Frontend stores data as base64 strings but database returns as binary
          // Convert binary data back to base64 strings
          const encPayload = credential.enc_payload.toString('base64');
          const iv = credential.iv.toString('base64');
          const authTag = credential.auth_tag.toString('base64');
          
          const decryptedCredentials = await this.decryptFrontendData(encPayload, iv, authTag);
          return { credentials: decryptedCredentials };
        } catch (frontendDecryptError) {
          console.error('Failed to decrypt frontend data:', frontendDecryptError);
          return { error: `Frontend decryption failed: ${frontendDecryptError.message}` };
        }
      }

      // Fallback to envelope decryption for backend-stored credentials (enc_version: 1)
      if (credential.is_encrypted && credential.enc_payload && credential.enc_version === 1) {
        try {
          const decryptionInput = {
            encPayload: credential.enc_payload,
            iv: credential.iv,
            authTag: credential.auth_tag,
            dekWrapped: credential.dek_wrapped,
            keyRef: credential.key_ref || 'env:v1',
            userId,
            credentialId: credential.id
          };

          const payload = EnvelopeEncryptionUtil.decrypt(decryptionInput);
          return { credentials: { ...payload.client, ...payload.token } };
        } catch (envelopeError) {
          console.error('Failed envelope decryption:', envelopeError);
          return { error: 'Failed to decrypt envelope credentials' };
        }
      }

      return { error: 'No valid credential data found' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { error: errorMessage };
    }
  }

  /**
   * Retrieve and decrypt credentials with dual-read capability
   */
  static async getCredentials(
    userId: string,
    serviceType: string,
    credentialName?: string
  ): Promise<DecryptedCredential[]> {
    try {
      let query = supabase
        .from('user_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('service_type', serviceType);

      if (credentialName) {
        query = query.eq('name', credentialName);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching credentials:', error);
        throw new Error('Failed to fetch credentials');
      }

      if (!data || data.length === 0) {
        return [];
      }

      const decryptedCredentials: DecryptedCredential[] = [];

      for (const record of data) {
        try {
          let credentials: Record<string, any>;

          if (record.is_encrypted && record.enc_payload) {
            // New envelope encryption path
            console.log(`🔓 Decrypting envelope credentials for ${record.service_type}:${record.name}`);
            
            const decryptionInput = {
              encPayload: record.enc_payload,
              iv: record.iv,
              authTag: record.auth_tag,
              dekWrapped: record.dek_wrapped,
              keyRef: record.key_ref || 'env:v1',
              userId,
              credentialId: record.id
            };

            const payload = EnvelopeEncryptionUtil.decrypt(decryptionInput);
            credentials = { ...payload.client, ...payload.token };

          } else {
            // Legacy decryption path for backward compatibility
            console.log(`🔓 Decrypting legacy credentials for ${record.service_type}:${record.name}`);
            
            const clientJson = record.client_json as Record<string, string> | null;
            const tokenJson = record.token_json as Record<string, string> | null;

            if (!clientJson && !tokenJson) {
              console.warn(`No credential data found for ${record.id}`);
              continue;
            }

            credentials = {};

            // Decrypt legacy client_json fields
            if (clientJson && typeof clientJson === 'object') {
              for (const [fieldName, encryptedValue] of Object.entries(clientJson)) {
                if (typeof encryptedValue === 'string') {
                  if (DecryptionUtil.isEncrypted(encryptedValue)) {
                    credentials[fieldName] = await DecryptionUtil.decrypt(encryptedValue);
                  } else {
                    credentials[fieldName] = encryptedValue;
                  }
                }
              }
            }

            // Decrypt legacy token_json fields
            if (tokenJson && typeof tokenJson === 'object') {
              for (const [fieldName, encryptedValue] of Object.entries(tokenJson)) {
                if (typeof encryptedValue === 'string') {
                  if (DecryptionUtil.isEncrypted(encryptedValue)) {
                    credentials[fieldName] = await DecryptionUtil.decrypt(encryptedValue);
                  } else {
                    credentials[fieldName] = encryptedValue;
                  }
                }
              }
            }

            // Schedule this record for migration
            this.scheduleMigration(record.id, userId, record.service_type, record.name);
          }

          decryptedCredentials.push({
            id: record.id,
            name: record.name,
            service_type: record.service_type,
            created_at: record.created_at,
            updated_at: record.updated_at,
            is_encrypted: record.is_encrypted || false,
            enc_version: record.enc_version,
            key_ref: record.key_ref,
            credentials
          });

        } catch (decryptError) {
          console.error(`Failed to decrypt credential ${record.id}:`, decryptError);
          // Continue with other credentials
        }
      }

      return decryptedCredentials;

    } catch (error) {
      console.error('Error in getCredentials:', error);
      throw error;
    }
  }

  /**
   * List credentials metadata without decryption
   */
  static async listCredentials(userId: string, serviceType?: string): Promise<UserCredential[]> {
    try {
      let query = supabase
        .from('user_credentials')
        .select('id, name, service_type, created_at, updated_at, is_encrypted, enc_version, key_ref')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (serviceType) {
        query = query.eq('service_type', serviceType);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error listing credentials:', error);
        throw new Error('Failed to list credentials');
      }

      return data || [];

    } catch (error) {
      console.error('Error in listCredentials:', error);
      throw error;
    }
  }

  /**
   * Delete a credential
   */
  static async deleteCredential(userId: string, credentialId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('user_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('id', credentialId);

      if (error) {
        console.error('Error deleting credential:', error);
        throw new Error('Failed to delete credential');
      }

      console.log(`🗑️ Deleted credential ${credentialId}`);

    } catch (error) {
      console.error('Error in deleteCredential:', error);
      throw error;
    }
  }

  /**
   * Migrate a legacy credential to envelope encryption
   */
  static async migrateCredential(
    credentialId: string,
    userId: string,
    serviceType: string,
    name: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Fetch the legacy credential
      const { data: record, error: fetchError } = await supabase
        .from('user_credentials')
        .select('*')
        .eq('id', credentialId)
        .eq('user_id', userId)
        .single();

      if (fetchError || !record) {
        return { success: false, error: 'Credential not found' };
      }

      if (record.is_encrypted) {
        return { success: true }; // Already migrated
      }

      // Decrypt legacy data
      const clientData: Record<string, any> = {};
      const tokenData: Record<string, any> = {};

      // Process client_json
      if (record.client_json && typeof record.client_json === 'object') {
        for (const [key, value] of Object.entries(record.client_json as Record<string, string>)) {
          if (typeof value === 'string') {
            clientData[key] = DecryptionUtil.isEncrypted(value) 
              ? await DecryptionUtil.decrypt(value)
              : value;
          }
        }
      }

      // Process token_json
      if (record.token_json && typeof record.token_json === 'object') {
        for (const [key, value] of Object.entries(record.token_json as Record<string, string>)) {
          if (typeof value === 'string') {
            tokenData[key] = DecryptionUtil.isEncrypted(value)
              ? await DecryptionUtil.decrypt(value)
              : value;
          }
        }
      }

      // Create envelope encrypted payload
      const payload: CredentialPayload = {
        service_type: serviceType,
        name,
        client: clientData,
        token: tokenData,
        scopes: record.scopes,
        meta: {
          migrated_from_plaintext: true,
          migrated_at: new Date().toISOString()
        }
      };

      const encryptionResult = EnvelopeEncryptionUtil.encrypt(
        payload,
        userId,
        credentialId
      );

      // Update the record
      const { error: updateError } = await supabase
        .from('user_credentials')
        .update({
          is_encrypted: true,
          enc_version: encryptionResult.encVersion,
          key_ref: encryptionResult.keyRef,
          key_algo: 'AES-256-GCM',
          enc_payload: encryptionResult.encPayload,
          iv: encryptionResult.iv,
          auth_tag: encryptionResult.authTag,
          dek_wrapped: encryptionResult.dekWrapped,
          // Clear legacy fields
          client_json: null,
          token_json: null,
          scopes: null
        })
        .eq('id', credentialId)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Error updating migrated credential:', updateError);
        return { success: false, error: 'Migration update failed' };
      }

      console.log(`✅ Migrated credential ${credentialId} to envelope encryption`);
      return { success: true };

    } catch (error) {
      console.error('Error in migrateCredential:', error);
      return {
        success: false,
        error: `Migration failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Schedule migration for legacy credentials (background process)
   */
  private static scheduleMigration(
    credentialId: string,
    userId: string,
    serviceType: string,
    name: string
  ): void {
    // In a production system, this would queue the migration
    // For now, we'll log it for manual processing
    console.log(`📋 Scheduled migration for credential ${credentialId} (${serviceType}:${name})`);
    
    // TODO: Implement background queue processing
    // Could use BullMQ or similar for proper background processing
  }

  /**
   * Get migration status for all credentials
   */
  static async getMigrationStatus(userId: string): Promise<{
    total: number;
    encrypted: number;
    legacy: number;
    migrationProgress: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('user_credentials')
        .select('is_encrypted')
        .eq('user_id', userId);

      if (error) {
        throw new Error('Failed to fetch migration status');
      }

      const total = data?.length || 0;
      const encrypted = data?.filter(row => row.is_encrypted).length || 0;
      const legacy = total - encrypted;
      const migrationProgress = total > 0 ? (encrypted / total) * 100 : 100;

      return {
        total,
        encrypted,
        legacy,
        migrationProgress: Math.round(migrationProgress)
      };

    } catch (error) {
      console.error('Error getting migration status:', error);
      throw error;
    }
  }

  /**
   * Batch migrate all legacy credentials for a user
   */
  static async batchMigrateUser(userId: string): Promise<{
    success: boolean;
    migrated: number;
    failed: number;
    errors: string[];
  }> {
    try {
      const { data: legacyCredentials, error } = await supabase
        .from('user_credentials')
        .select('id, service_type, name')
        .eq('user_id', userId)
        .eq('is_encrypted', false);

      if (error) {
        throw new Error('Failed to fetch legacy credentials');
      }

      if (!legacyCredentials || legacyCredentials.length === 0) {
        return { success: true, migrated: 0, failed: 0, errors: [] };
      }

      let migrated = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const credential of legacyCredentials) {
        const result = await this.migrateCredential(
          credential.id,
          userId,
          credential.service_type,
          credential.name
        );

        if (result.success) {
          migrated++;
        } else {
          failed++;
          errors.push(`${credential.service_type}:${credential.name} - ${result.error}`);
        }
      }

      console.log(`🔄 Batch migration completed: ${migrated} migrated, ${failed} failed`);
      
      return {
        success: failed === 0,
        migrated,
        failed,
        errors
      };

    } catch (error) {
      console.error('Error in batchMigrateUser:', error);
      return {
        success: false,
        migrated: 0,
        failed: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
  /**
   * Decrypt client-side encrypted data using Node.js crypto
   */
  private static async decryptClientData(encryptedData: string, encryptionKey: string): Promise<any> {
    const crypto = await import('crypto');
    
    try {
      // Convert base64 to buffer
      const combined = Buffer.from(encryptedData, 'base64');
      
      // Extract IV (first 12 bytes) and encrypted data
      const iv = combined.subarray(0, 12);
      const encrypted = combined.subarray(12, -16); // Remove auth tag from end
      const authTag = combined.subarray(-16); // Last 16 bytes
      
      // Create key buffer
      const keyBuffer = Buffer.from(encryptionKey, 'base64');
      
      // Create decipher
      const decipher = crypto.createDecipherGCM('aes-256-gcm', keyBuffer);
      decipher.setIV(iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt client data');
    }
  }

  /**
   * Decrypt frontend data (enc_version: 2) using the same method as frontend
   */
  private static async decryptFrontendData(encPayload: string, iv: string, authTag: string): Promise<any> {
    const crypto = await import('crypto');
    
    try {
      // Get encryption key from environment
      const encryptionKey = process.env.COREZA_ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new Error('Encryption key not available');
      }
      
      // Convert base64 strings back to buffers
      const ivBuffer = Buffer.from(iv, 'base64');
      const ciphertextBuffer = Buffer.from(encPayload, 'base64');
      const authTagBuffer = Buffer.from(authTag, 'base64');
      
      // Create key buffer - same derivation as frontend edge function
      const keyBuffer = Buffer.from(encryptionKey, 'base64');
      
      // Create decipher
      const decipher = crypto.createDecipherGCM('aes-256-gcm', keyBuffer);
      decipher.setIV(ivBuffer);
      decipher.setAuthTag(authTagBuffer);
      
      // Decrypt
      let decrypted = decipher.update(ciphertextBuffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      console.error('Frontend decryption error:', error);
      throw new Error(`Failed to decrypt frontend data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export default CredentialManager;
