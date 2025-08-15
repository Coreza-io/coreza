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

  static async encrypt(data: any): Promise<{
    enc_payload: string;
    iv: string;
    auth_tag: string;
  }> {
    try {
      const key = await this.getEncryptionKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      console.log('🔑 Generated IV:', { length: iv.length, bytes: Array.from(iv) });
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(JSON.stringify(data));
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        dataBuffer
      );
      
      console.log('🔑 After encryption:', { 
        encrypted_length: encrypted.byteLength,
        iv_used_length: iv.length 
      });
      
      // Extract the actual encrypted data and auth tag
      const encryptedArray = new Uint8Array(encrypted);
      const ciphertext = encryptedArray.slice(0, -16); // All but last 16 bytes
      const authTag = encryptedArray.slice(-16); // Last 16 bytes are the auth tag
      
      console.log('🔑 Extracted components:', { 
        ciphertext_length: ciphertext.length,
        auth_tag_length: authTag.length,
        iv_final_length: iv.length
      });
      
      const result = {
        enc_payload: btoa(String.fromCharCode(...ciphertext)),
        iv: btoa(String.fromCharCode(...iv)),
        auth_tag: btoa(String.fromCharCode(...authTag))
      };
      
      console.log('🔑 Encryption result:', { 
        iv_length: iv.length,
        iv_base64: result.iv,
        iv_base64_length: result.iv.length,
        decoded_iv_length: atob(result.iv).length
      });
      
      return result;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  static async decrypt(encPayload: string, iv: string, authTag: string): Promise<any> {
    try {
      const key = await this.getEncryptionKey();
      
      // Convert base64 strings back to Uint8Arrays
      const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
      const ciphertextBytes = Uint8Array.from(atob(encPayload), c => c.charCodeAt(0));
      const authTagBytes = Uint8Array.from(atob(authTag), c => c.charCodeAt(0));
      
      // Reconstruct the data that Web Crypto expects (ciphertext + authTag)
      const encryptedBuffer = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
      encryptedBuffer.set(ciphertextBytes);
      encryptedBuffer.set(authTagBytes, ciphertextBytes.length);
      
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
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
          enc_payload: encryptedCredentials.enc_payload,
          iv: encryptedCredentials.iv,
          auth_tag: encryptedCredentials.auth_tag,
          is_encrypted: true,
          enc_version: 2,
          key_ref: 'user:v2',
          key_algo: 'AES-256-GCM',
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