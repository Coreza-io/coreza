import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';

// Mock Supabase configuration to avoid environment dependencies
jest.mock('../coreza-backend/src/config/supabase', () => ({
  supabase: {}
}));
// Mock envelope encryption utility to avoid type issues during compilation
jest.mock('../coreza-backend/src/utils/envelopeEncryption', () => ({
  __esModule: true,
  default: {}
}), { virtual: true });

import CredentialManager from '../coreza-backend/src/utils/credentialManager';

describe('decryptClientData', () => {
  it('decrypts data encrypted with AES-256-GCM', async () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const original = { foo: 'bar', count: 42 };

    let encrypted = cipher.update(JSON.stringify(original), 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, encrypted, authTag]).toString('base64');

    const decrypted = await (CredentialManager as any).decryptClientData(payload, key.toString('base64'));
    expect(decrypted).toEqual(original);
  });

  it('throws an error when key length is invalid', async () => {
    const validKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', validKey, iv);
    const data = { test: true };

    let encrypted = cipher.update(JSON.stringify(data), 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, encrypted, authTag]).toString('base64');

    const invalidKey = crypto.randomBytes(16).toString('base64');
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect((CredentialManager as any).decryptClientData(payload, invalidKey)).rejects.toThrow(
      'Failed to decrypt client data'
    );
    expect(errorSpy).toHaveBeenCalled();
    const errorArg = errorSpy.mock.calls[0][1] as Error;
    expect(errorArg.message).toContain('Invalid key length');
    errorSpy.mockRestore();
  });
});
