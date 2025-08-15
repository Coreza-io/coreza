/**
 * Enhanced Credential Manager with envelope encryption support
 * Provides dual-read capability and secure migration path
 */

import { supabase } from '../config/supabase';
import EnvelopeEncryptionUtil from './envelopeEncryption';
import DecryptionUtil from './decryption';
import { CredentialValidator } from './credentialValidator';

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

class EnhancedCredentialManager {
  /**
   * Store credentials using envelope encryption
   */
  static async storeCredentials(
    userId: string,
    serviceType: string,
    name: string,
    clientData: Record<string, any>,
    tokenData: Record<string, any> = {},
    scopes?: string
  ): Promise<{ success: boolean; credentialId?: string; error?: string }> {
    try {
      // Validate credentials before storing
      const combinedCredentials = { ...clientData, ...tokenData };
      const validation = CredentialValidator.validateCredentials(serviceType, combinedCredentials);
      
      if (!validation.isValid) {
        return {
          success: false,
          error: `Validation failed: ${validation.errors.join(', ')}`
        };
      }

      // Create unified payload
      const payload: CredentialPayload = {
        service_type: serviceType,
        name,
        client: clientData,
        token: tokenData,
        scopes,
        meta: {
          created_with_envelope: true,
          migrated_from_plaintext: false
        }
      };

      // Generate credential ID for AAD binding
      const credentialId = crypto.randomUUID();

      // Encrypt using envelope encryption
      const encryptionResult = EnvelopeEncryptionUtil.encrypt(
        payload,
        userId,
        credentialId
      );

      // Store in database
      const { data, error } = await supabase
        .from('user_credentials')
        .upsert({
          id: credentialId,
          user_id: userId,
          service_type: serviceType,
          name,
          is_encrypted: true,
          enc_version: encryptionResult.encVersion,
          key_ref: encryptionResult.keyRef,
          key_algo: 'AES-256-GCM',
          enc_payload: encryptionResult.encPayload,
          iv: encryptionResult.iv,
          auth_tag: encryptionResult.authTag,
          dek_wrapped: encryptionResult.dekWrapped,
          // Keep legacy fields null for new records
          client_json: null,
          token_json: null,
          scopes: null
        }, {
          onConflict: 'user_id,service_type,name'
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error storing credentials:', error);
        return { success: false, error: 'Failed to store credentials' };
      }

      console.log(`✅ Stored encrypted credentials for ${serviceType}:${name}`);
      return { success: true, credentialId: data.id };

    } catch (error) {
      console.error('Error in storeCredentials:', error);
      return {
        success: false,
        error: `Storage failed: ${error instanceof Error ? error.message : String(error)}`
      };
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
}

export default EnhancedCredentialManager;
