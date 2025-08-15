/**
 * Server-side encryption utility for sensitive data
 * Uses Node.js crypto module for secure encryption
 */

import crypto from 'crypto';

class EncryptionUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits

  /**
   * Derive a key from user ID for consistent encryption
   */
  private static deriveKey(userId: string): Buffer {
    // Use PBKDF2 to derive a key from userId
    const salt = Buffer.from('supabase-credentials-salt', 'utf8');
    return crypto.pbkdf2Sync(userId, salt, 100000, this.KEY_LENGTH, 'sha256');
  }

  /**
   * Encrypt sensitive data
   */
  static encrypt(data: string, userId: string): string {
    try {
      const key = this.deriveKey(userId);
      const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
      
      const cipher = crypto.createCipher(this.ALGORITHM, key);
      cipher.setAAD(Buffer.from(userId, 'utf8')); // Additional authenticated data
      
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Combine IV, authTag, and encrypted data
      const combined = Buffer.concat([
        iv,
        authTag,
        Buffer.from(encrypted, 'hex')
      ]);
      
      return combined.toString('base64');
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt sensitive data
   */
  static decrypt(encryptedData: string, userId: string): string {
    try {
      const key = this.deriveKey(userId);
      const combined = Buffer.from(encryptedData, 'base64');
      
      // Extract IV, authTag, and encrypted data
      const iv = combined.slice(0, 12);
      const authTag = combined.slice(12, 28);
      const encrypted = combined.slice(28);
      
      const decipher = crypto.createDecipher(this.ALGORITHM, key);
      decipher.setAAD(Buffer.from(userId, 'utf8'));
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }
}

export default EncryptionUtil;