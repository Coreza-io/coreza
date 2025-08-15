/**
 * Frontend Credential Manager - Encryption and Storage Only
 * Handles client-side encryption and direct database storage
 */

import { supabase } from '@/integrations/supabase/client';


// Client-side encryption utility using Web Crypto API
class ClientEncryption {
  private static async getEncryptionKey(): Promise<CryptoKey> {
    try {
      console.log('🔑 Requesting encryption key from edge function...');
      const { data, error } = await supabase.functions.invoke('derive-encryption-key');
      
      if (error) {
        console.error('Edge function error:', error);
        throw new Error(`Failed to get encryption key: ${error.message}`);
      }
      
      if (!data?.key) {
        console.error('No key in response:', data);
        throw new Error('No encryption key received from server');
      }
      
      console.log('✅ Encryption key received successfully');
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
      throw new Error(`Failed to initialize encryption: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      
      // Extract the actual encrypted data and auth tag
      const encryptedArray = new Uint8Array(encrypted);
      const ciphertext = encryptedArray.slice(0, -16); // All but last 16 bytes
      const authTag = encryptedArray.slice(-16); // Last 16 bytes are the auth tag
      
      // Combine: IV + ciphertext + authTag
      const combined = new Uint8Array(iv.length + ciphertext.length + authTag.length);
      combined.set(iv);
      combined.set(ciphertext, iv.length);
      combined.set(authTag, iv.length + ciphertext.length);
      
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
      const ciphertext = combined.slice(12, -16);
      const authTag = combined.slice(-16);
      
      // Reconstruct the data that Web Crypto expects (ciphertext + authTag)
      const encryptedBuffer = new Uint8Array(ciphertext.length + authTag.length);
      encryptedBuffer.set(ciphertext);
      encryptedBuffer.set(authTag, ciphertext.length);
      
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedBuffer
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
    // Input validation
    if (!userId || !serviceType || !credentialName || !credentials) {
      throw new Error('Missing required parameters');
    }
    
    // Sanitize inputs
    const sanitizedServiceType = serviceType.replace(/[^a-zA-Z0-9_-]/g, '');
    const sanitizedCredentialName = credentialName.substring(0, 100); // Limit length
    
    try {
      console.log(`🔐 Encrypting credentials for ${sanitizedServiceType}:${sanitizedCredentialName}`);
      
      const encryptedCredentials = await ClientEncryption.encrypt(credentials);
      
      const { error } = await supabase
        .from('user_credentials')
        .upsert({
          user_id: userId,
          service_type: sanitizedServiceType,
          name: sanitizedCredentialName,
          client_json: encryptedCredentials,
          scopes: scopes?.substring(0, 255), // Limit scope length
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,service_type,name'
        });

      if (error) {
        console.error('Error storing credentials:', error);
        throw new Error(`Failed to store credentials: ${error.message}`);
      }
      
      console.log(`✅ Successfully stored encrypted credentials for ${sanitizedServiceType}:${sanitizedCredentialName}`);
    } catch (error) {
      console.error('Error storing credentials:', error);
      throw error;
    }
  }


  /**
   * Delete a credential
   */
  static async deleteCredential(userId: string, credentialId: string): Promise<void> {
    // Input validation
    if (!userId || !credentialId) {
      throw new Error('Missing required parameters');
    }
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(credentialId)) {
      throw new Error('Invalid credential ID format');
    }
    
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