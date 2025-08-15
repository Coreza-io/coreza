/**
 * Security test suite for encryption/decryption and credential handling
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import DecryptionUtil from '../utils/decryption';
import { CredentialValidator } from '../utils/credentialValidator';
import { SecurityAuditor } from '../utils/securityAudit';

describe('Security Tests', () => {
  describe('Encryption/Decryption', () => {
    beforeAll(() => {
      // Set up test encryption key
      process.env.COREZA_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-long-for-aes256').toString('base64');
    });

    afterAll(() => {
      delete process.env.COREZA_ENCRYPTION_KEY;
    });

    it('should detect encrypted data correctly', () => {
      const plainText = 'plain-api-key-123';
      const encryptedLikeData = 'dGVzdC1lbmNyeXB0ZWQtZGF0YS13aXRoLWxvbmctc3RyaW5n';
      
      expect(DecryptionUtil.isEncrypted(plainText)).toBe(false);
      expect(DecryptionUtil.isEncrypted('pk_test_123')).toBe(false);
      expect(DecryptionUtil.isEncrypted('sk_live_456')).toBe(false);
      expect(DecryptionUtil.isEncrypted(encryptedLikeData)).toBe(true);
    });

    it('should handle invalid encryption key gracefully', async () => {
      const originalKey = process.env.COREZA_ENCRYPTION_KEY;
      process.env.COREZA_ENCRYPTION_KEY = 'invalid-key';

      const encryptedData = 'dGVzdC1lbmNyeXB0ZWQtZGF0YS13aXRoLWxvbmctc3RyaW5n';
      
      await expect(DecryptionUtil.decrypt(encryptedData)).rejects.toThrow();
      
      process.env.COREZA_ENCRYPTION_KEY = originalKey;
    });
  });

  describe('Credential Validation', () => {
    it('should validate Alpaca credentials correctly', () => {
      const validCreds = {
        api_key: 'PKTEST123456789',
        secret_key: 'SKTEST987654321'
      };

      const invalidCreds = {
        api_key: '123', // too short
        secret_key: '' // missing
      };

      const validResult = CredentialValidator.validateCredentials('alpaca', validCreds);
      const invalidResult = CredentialValidator.validateCredentials('alpaca', invalidCreds);

      expect(validResult.isValid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });

    it('should sanitize credentials for logging', () => {
      const credentials = {
        api_key: 'PKTEST1234567890ABCDEF',
        secret_key: 'SKTEST0987654321FEDCBA',
        some_other_field: 'safe-data'
      };

      const sanitized = CredentialValidator.sanitizeForLogging(credentials);

      expect(sanitized.api_key).toBe('PKTE...CDEF');
      expect(sanitized.secret_key).toBe('SKTE...DCBA');
      expect(sanitized.some_other_field).toBe('safe-data');
    });
  });

  describe('Security Auditing', () => {
    it('should perform quick security check', async () => {
      const result = await SecurityAuditor.quickSecurityCheck();
      
      expect(result).toHaveProperty('safe');
      expect(result).toHaveProperty('issues');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should detect missing encryption key', async () => {
      const originalKey = process.env.COREZA_ENCRYPTION_KEY;
      delete process.env.COREZA_ENCRYPTION_KEY;

      const result = await SecurityAuditor.quickSecurityCheck();
      
      expect(result.safe).toBe(false);
      expect(result.issues).toContain('Missing encryption key');
      
      process.env.COREZA_ENCRYPTION_KEY = originalKey;
    });
  });

  describe('Memory Security', () => {
    it('should implement secure wipe function', () => {
      const sensitiveData = 'sensitive-api-key-data';
      
      // This is mostly a smoke test since JavaScript memory management
      // is not directly controllable
      expect(() => {
        DecryptionUtil.secureWipe(sensitiveData);
      }).not.toThrow();
    });
  });
});