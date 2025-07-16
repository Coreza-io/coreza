/**
 * Credential Manager for secure handling of encrypted user credentials
 */

import { supabase } from '@/integrations/supabase/client';
import EncryptionUtil from './encryption';

export interface UserCredential {
  id: string;
  name: string;
  service_type: string;
  created_at: string;
  updated_at: string;
}

export interface DecryptedCredential extends UserCredential {
  credentials: Record<string, string>;
}

class CredentialManager {
  /**
   * Retrieve and decrypt user credentials for a specific service
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

      // Decrypt each credential
      const decryptedCredentials: DecryptedCredential[] = [];

      for (const record of data) {
        try {
          // The client_json should contain { encrypted: "encrypted_string" }
          const clientJson = record.client_json as { encrypted?: string } | null;
          const encryptedData = clientJson?.encrypted;
          
          if (!encryptedData || typeof encryptedData !== 'string') {
            console.warn(`Invalid encrypted data for credential ${record.id}`);
            continue;
          }

          // Decrypt the data
          const decryptedDataString = await EncryptionUtil.decrypt(encryptedData, userId);
          const credentials = JSON.parse(decryptedDataString);

          decryptedCredentials.push({
            id: record.id,
            name: record.name,
            service_type: record.service_type,
            created_at: record.created_at,
            updated_at: record.updated_at,
            credentials
          });

        } catch (decryptError) {
          console.error(`Failed to decrypt credential ${record.id}:`, decryptError);
          // Skip this credential but continue with others
        }
      }

      return decryptedCredentials;

    } catch (error) {
      console.error('Error in getCredentials:', error);
      throw error;
    }
  }

  /**
   * Get all available credentials for a user (without decrypting)
   */
  static async listCredentials(userId: string): Promise<UserCredential[]> {
    try {
      const { data, error } = await supabase
        .from('user_credentials')
        .select('id, name, service_type, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

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

    } catch (error) {
      console.error('Error in deleteCredential:', error);
      throw error;
    }
  }
}

export default CredentialManager;