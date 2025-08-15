/**
 * Server-side decryption utility for sensitive data
 * Uses global encryption key like N8N's approach with AES-256-GCM
 */

import { webcrypto } from 'crypto';

// Use Node.js crypto polyfill for Web Crypto API
const crypto = webcrypto as unknown as Crypto;

class DecryptionUtil {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;

  /**
   * Get the global encryption key from environment
   */
  private static getEncryptionKey(): string {
    const key = process.env.COREZA_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('COREZA_ENCRYPTION_KEY not found in environment');
    }
    return key;
  }

  /**
   * Import the encryption key (base64 string) for use with Web Crypto API
   */
  private static async importKey(keyString: string): Promise<CryptoKey> {
    // Decode base64 key and ensure it's exactly 32 bytes (256 bits)
    const keyBuffer = Uint8Array.from(Buffer.from(keyString, 'base64'));
    
    // Ensure the key is exactly 32 bytes (256 bits) for AES-256
    let processedKey: Uint8Array;
    if (keyBuffer.length >= 32) {
      processedKey = keyBuffer.slice(0, 32); // Take first 32 bytes
    } else {
      // Pad with zeros if key is too short
      processedKey = new Uint8Array(32);
      processedKey.set(keyBuffer);
    }
    
    return await crypto.subtle.importKey(
      'raw',
      processedKey,
      {
        name: this.ALGORITHM,
        length: this.KEY_LENGTH,
      },
      false,
      ['decrypt']
    );
  }

  /**
   * Decrypt sensitive data that was encrypted by the frontend using global key
   */
  static async decrypt(encryptedData: string): Promise<string> {
    try {
      const keyString = this.getEncryptionKey();
      const key = await this.importKey(keyString);
      
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
   * Enhanced check if a string appears to be encrypted (base64 encoded)
   */
  static isEncrypted(data: string): boolean {
    if (!data || typeof data !== 'string') {
      return false;
    }
    
    // Skip if it looks like a plain text API key or common patterns
    if (data.startsWith('pk_') || data.startsWith('sk_') || data.startsWith('test_') || 
        data.startsWith('live_') || data.length < 20 || !data.includes('=')) {
      return false;
    }
    
    try {
      // Check if it's valid base64 and has reasonable length for encrypted data
      const decoded = Buffer.from(data, 'base64');
      // Must be at least IV (12 bytes) + auth tag (16 bytes) + some encrypted data
      return decoded.length >= 40;
    } catch {
      return false;
    }
  }

  /**
   * Securely clear decrypted data from memory (best effort)
   */
  static secureWipe(data: string): void {
    try {
      // This is a best effort approach - JavaScript doesn't guarantee memory clearing
      if (typeof data === 'string') {
        // Convert to buffer and fill with zeros
        const buffer = Buffer.from(data);
        buffer.fill(0);
      }
    } catch (error) {
      // Silently handle wipe errors
    }
  }
}

export default DecryptionUtil;