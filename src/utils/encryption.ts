/**
 * Client-side encryption utility for sensitive data
 * Uses global encryption key like N8N's approach with AES-256-GCM
 */

class EncryptionUtil {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;

  /**
   * Get the global encryption key from environment variable
   */
  private static getEncryptionKey(): string {
    const key = import.meta.env.VITE_COREZA_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('VITE_COREZA_ENCRYPTION_KEY not found in environment variables');
    }
    return key;
  }

  /**
   * Import the encryption key (base64 string) for use with Web Crypto API
   */
  private static async importKey(keyString: string): Promise<CryptoKey> {
    // Decode base64 key like N8N does
    const keyBuffer = Uint8Array.from(atob(keyString), c => c.charCodeAt(0));
    
    return await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      {
        name: this.ALGORITHM,
        length: this.KEY_LENGTH,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt sensitive data using global encryption key
   */
  static async encrypt(data: string): Promise<string> {
    try {
      const keyString = this.getEncryptionKey();
      const key = await this.importKey(keyString);
      const encoder = new TextEncoder();
      const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

      const encrypted = await crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv: iv,
        },
        key,
        encoder.encode(data)
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);

      // Convert to base64 for storage
      return btoa(String.fromCharCode.apply(null, Array.from(combined)));
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt sensitive data using global encryption key
   */
  static async decrypt(encryptedData: string): Promise<string> {
    try {
      const keyString = this.getEncryptionKey();
      const key = await this.importKey(keyString);
      
      // Convert from base64
      const combined = new Uint8Array(
        atob(encryptedData)
          .split('')
          .map(char => char.charCodeAt(0))
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
}

export default EncryptionUtil;