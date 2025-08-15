/**
 * Frontend Credential Manager with direct encryption and database storage
 * Handles encryption client-side and stores directly to Supabase
 */

import { supabase } from '@/integrations/supabase/client';

export interface UserCredential {
  id: string;
  user_id: string;
  service_type: string;
  name: string;
  scopes?: string;
  created_at: string;
  updated_at: string;
}

export interface DecryptedCredential extends UserCredential {
  credentials: any;
}

// Client-side encryption utility using Web Crypto API
class ClientEncryption {
  private static async getEncryptionKey(): Promise<CryptoKey> {
    try {
      const { data, error } = await supabase.functions.invoke('get-encryption-key');
      if (error || !data?.key) {
        throw new Error('Failed to get encryption key');
      }
      
      const keyData = Uint8Array.from(atob(data.key), c => c.charCodeAt(0));
      return await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      console.error('Error getting encryption key:', error);
      throw new Error('Failed to initialize encryption');
    }
  }

  static async encrypt(data: any): Promise<string> {
    try {
      const key = await this.getEncryptionKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(JSON.stringify(data));
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        dataBuffer
      );
      
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      
      return btoa(String.fromCharCode(...combined));
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  static async decrypt(encryptedData: string): Promise<any> {
    try {
      const key = await this.getEncryptionKey();
      const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);
      
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
      );
      
      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(decrypted));
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }
}

export class CredentialManager {
  /**
   * Store credentials with client-side encryption
   */
  static async storeCredentials(
    userId: string, 
    serviceType: string, 
    credentialName: string, 
    credentials: any, 
    scopes?: string
  ): Promise<void> {
    try {
      console.log(`🔐 Encrypting credentials for ${serviceType}:${credentialName}`);
      
      const encryptedCredentials = await ClientEncryption.encrypt(credentials);
      
      const { error } = await supabase
        .from('user_credentials')
        .upsert({
          user_id: userId,
          service_type: serviceType,
          name: credentialName,
          client_json: encryptedCredentials,
          scopes,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,service_type,name'
        });

      if (error) {
        console.error('Error storing credentials:', error);
        throw new Error(`Failed to store credentials: ${error.message}`);
      }
      
      console.log(`✅ Successfully stored encrypted credentials for ${serviceType}:${credentialName}`);
    } catch (error) {
      console.error('Error storing credentials:', error);
      throw error;
    }
  }

  /**
   * Retrieve and decrypt credentials
   */
  static async getCredentials(
    userId: string, 
    serviceType: string, 
    credentialName?: string
  ): Promise<DecryptedCredential[]> {
    try {
      console.log(`🔓 Retrieving credentials for ${serviceType}${credentialName ? `:${credentialName}` : ''}`);
      
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
        throw new Error(`Failed to fetch credentials: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return [];
      }

      const decryptedCredentials = await Promise.all(
        data.map(async (cred) => {
          try {
            const decryptedData = await ClientEncryption.decrypt(cred.client_json as string);
            return {
              id: cred.id,
              user_id: cred.user_id,
              service_type: cred.service_type,
              name: cred.name,
              scopes: cred.scopes,
              created_at: cred.created_at || '',
              updated_at: cred.updated_at || '',
              credentials: decryptedData
            };
          } catch (decryptError) {
            console.error(`Failed to decrypt credential ${cred.id}:`, decryptError);
            throw new Error(`Failed to decrypt credentials for ${cred.name}`);
          }
        })
      );

      console.log(`✅ Successfully decrypted ${decryptedCredentials.length} credentials`);
      return decryptedCredentials;
    } catch (error) {
      console.error('Error fetching credentials:', error);
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
        .select('id, user_id, service_type, name, scopes, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (serviceType) {
        query = query.eq('service_type', serviceType);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error listing credentials:', error);
        throw new Error(`Failed to list credentials: ${error.message}`);
      }

      return (data || []).map(cred => ({
        id: cred.id,
        user_id: cred.user_id,
        service_type: cred.service_type,
        name: cred.name,
        scopes: cred.scopes,
        created_at: cred.created_at || '',
        updated_at: cred.updated_at || ''
      }));
    } catch (error) {
      console.error('Error listing credentials:', error);
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
        .eq('id', credentialId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting credential:', error);
        throw new Error(`Failed to delete credential: ${error.message}`);
      }
      
      console.log(`🗑️ Successfully deleted credential ${credentialId}`);
    } catch (error) {
      console.error('Error deleting credential:', error);
      throw error;
    }
  }
}

export default CredentialManager;