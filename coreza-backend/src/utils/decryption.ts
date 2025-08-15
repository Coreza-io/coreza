/**
 * Server-side decryption utility for sensitive data
 * Compatible with frontend encryption using Web Crypto API
 */

import { webcrypto } from 'crypto';

// Use Node.js crypto polyfill for Web Crypto API
const crypto = webcrypto as unknown as Crypto;

class DecryptionUtil {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;

  /**
   * Derive a key from user ID for consistent decryption
   * This must match the frontend encryption key derivation
   */
  private static async deriveKey(userId: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(userId.padEnd(32, '0')), // Ensure 32 bytes
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('supabase-credentials-salt'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      {
        name: this.ALGORITHM,
        length: this.KEY_LENGTH,
      },
      false,
      ['decrypt']
    );
  }

  /**
   * Decrypt sensitive data that was encrypted by the frontend
   */
  static async decrypt(encryptedData: string, userId: string): Promise<string> {
    try {
      const key = await this.deriveKey(userId);
      
      // Convert from base64
      const combined = new Uint8Array(
        Buffer.from(encryptedData, 'base64')
      );

      // Extract IV and encrypted data
      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: iv,
        },
        key,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Check if a string appears to be encrypted (base64 encoded)
   */
  static isEncrypted(data: string): boolean {
    if (!data || typeof data !== 'string') {
      return false;
    }
    
    try {
      // Check if it's valid base64 and has reasonable length for encrypted data
      const decoded = Buffer.from(data, 'base64');
      return decoded.length > 12; // At least IV (12 bytes) + some encrypted data
    } catch {
      return false;
    }
  }
}

export default DecryptionUtil;