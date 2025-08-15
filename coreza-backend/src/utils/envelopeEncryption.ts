/**
 * Production-grade envelope encryption utility for sensitive credential data
 * Uses AES-256-GCM with per-row DEKs wrapped by a global KEK
 */

import { randomBytes, createCipherGCM, createDecipherGCM } from 'crypto';

export interface EnvelopeData {
  v: number;        // version
  alg: string;      // algorithm 
  iv: string;       // base64 IV
  ct: string;       // base64 ciphertext + auth tag
  kid: string;      // key identifier
}

export interface EncryptionResult {
  encPayload: Buffer;
  iv: Buffer;
  authTag: Buffer;
  dekWrapped: Buffer;
  keyRef: string;
  encVersion: number;
}

export interface DecryptionInput {
  encPayload: Buffer;
  iv: Buffer;
  authTag: Buffer;
  dekWrapped: Buffer;
  keyRef: string;
  userId: string;
  credentialId?: string;
}

class EnvelopeEncryptionUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly DEK_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 12;  // 96 bits for GCM
  private static readonly TAG_LENGTH = 16; // 128 bits

  /**
   * Get the global encryption key from environment variable
   */
  private static getKEK(keyRef: string = 'env:v1'): Buffer {
    const key = process.env.COREZA_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('COREZA_ENCRYPTION_KEY not found in environment variables');
    }

    // Decode base64 key and ensure it's exactly 32 bytes
    const keyBuffer = Buffer.from(key, 'base64');
    if (keyBuffer.length < 32) {
      // Pad with zeros if too short
      const paddedKey = Buffer.alloc(32);
      keyBuffer.copy(paddedKey);
      return paddedKey;
    }
    
    return keyBuffer.slice(0, 32); // Take first 32 bytes
  }

  /**
   * Generate a new random DEK (Data Encryption Key)
   */
  private static generateDEK(): Buffer {
    return randomBytes(this.DEK_LENGTH);
  }

  /**
   * Wrap (encrypt) a DEK using the KEK
   */
  private static wrapDEK(dek: Buffer, keyRef: string): Buffer {
    const kek = this.getKEK(keyRef);
    const iv = randomBytes(this.IV_LENGTH);
    
    const cipher = createCipherGCM(this.ALGORITHM, kek);
    cipher.setIV(iv);
    
    const encrypted = Buffer.concat([
      cipher.update(dek),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV + encrypted DEK + auth tag
    return Buffer.concat([iv, encrypted, authTag]);
  }

  /**
   * Unwrap (decrypt) a DEK using the KEK
   */
  private static unwrapDEK(wrappedDEK: Buffer, keyRef: string): Buffer {
    const kek = this.getKEK(keyRef);
    
    // Extract components
    const iv = wrappedDEK.slice(0, this.IV_LENGTH);
    const authTag = wrappedDEK.slice(-this.TAG_LENGTH);
    const encrypted = wrappedDEK.slice(this.IV_LENGTH, -this.TAG_LENGTH);
    
    const decipher = createDecipherGCM(this.ALGORITHM, kek);
    decipher.setIV(iv);
    decipher.setAuthTag(authTag);
    
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
  }

  /**
   * Create AAD (Additional Authenticated Data) for binding
   */
  private static createAAD(userId: string, credentialId?: string): Buffer {
    const aadString = credentialId ? `${userId}:${credentialId}` : userId;
    return Buffer.from(aadString, 'utf8');
  }

  /**
   * Encrypt credential payload using envelope encryption
   */
  static encrypt(
    payload: any, 
    userId: string, 
    credentialId?: string, 
    keyRef: string = 'env:v1'
  ): EncryptionResult {
    try {
      // Generate per-row DEK and IV
      const dek = this.generateDEK();
      const iv = randomBytes(this.IV_LENGTH);
      const aad = this.createAAD(userId, credentialId);

      // Encrypt payload with DEK
      const cipher = createCipherGCM(this.ALGORITHM, dek);
      cipher.setIV(iv);
      cipher.setAAD(aad);

      const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
      const encrypted = Buffer.concat([
        cipher.update(payloadBuffer),
        cipher.final()
      ]);
      
      const authTag = cipher.getAuthTag();

      // Wrap DEK with KEK
      const dekWrapped = this.wrapDEK(dek, keyRef);

      // Create JSON envelope
      const envelope: EnvelopeData = {
        v: 1,
        alg: 'AES-256-GCM',
        iv: iv.toString('base64'),
        ct: Buffer.concat([encrypted, authTag]).toString('base64'),
        kid: keyRef
      };

      const encPayload = Buffer.from(JSON.stringify(envelope), 'utf8');

      // Secure cleanup
      this.secureWipe(dek);
      this.secureWipe(payloadBuffer);

      return {
        encPayload,
        iv,
        authTag,
        dekWrapped,
        keyRef,
        encVersion: 1
      };

    } catch (error) {
      throw new Error(`Envelope encryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Decrypt credential payload using envelope encryption
   */
  static decrypt(input: DecryptionInput): any {
    try {
      // Parse envelope
      const envelopeString = input.encPayload.toString('utf8');
      const envelope: EnvelopeData = JSON.parse(envelopeString);

      // Validate envelope
      this.validateEnvelope(envelope);

      // Unwrap DEK
      const dek = this.unwrapDEK(input.dekWrapped, input.keyRef);
      
      // Prepare decryption
      const iv = Buffer.from(envelope.iv, 'base64');
      const ctWithTag = Buffer.from(envelope.ct, 'base64');
      
      // Split ciphertext and auth tag
      const authTag = ctWithTag.slice(-this.TAG_LENGTH);
      const ciphertext = ctWithTag.slice(0, -this.TAG_LENGTH);
      
      const aad = this.createAAD(input.userId, input.credentialId);

      // Decrypt payload
      const decipher = createDecipherGCM(this.ALGORITHM, dek);
      decipher.setIV(iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);

      const payload = JSON.parse(decrypted.toString('utf8'));

      // Secure cleanup
      this.secureWipe(dek);
      this.secureWipe(decrypted);

      return payload;

    } catch (error) {
      throw new Error(`Envelope decryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deterministic check if data is envelope encrypted
   */
  static isEnvelopeEncrypted(data: Buffer | string): boolean {
    try {
      const dataString = Buffer.isBuffer(data) ? data.toString('utf8') : data;
      const parsed = JSON.parse(dataString);
      
      return typeof parsed === 'object' &&
             typeof parsed.v === 'number' &&
             typeof parsed.alg === 'string' &&
             typeof parsed.iv === 'string' &&
             typeof parsed.ct === 'string' &&
             typeof parsed.kid === 'string' &&
             parsed.v >= 1 &&
             parsed.alg === 'AES-256-GCM';
    } catch {
      return false;
    }
  }

  /**
   * Validate envelope structure
   */
  private static validateEnvelope(envelope: EnvelopeData): void {
    if (!envelope.v || envelope.v < 1) {
      throw new Error('Invalid envelope version');
    }
    
    if (envelope.alg !== 'AES-256-GCM') {
      throw new Error(`Unsupported algorithm: ${envelope.alg}`);
    }
    
    if (!envelope.kid || !envelope.kid.startsWith('env:')) {
      throw new Error(`Invalid key reference: ${envelope.kid}`);
    }

    // Validate base64 fields
    try {
      const iv = Buffer.from(envelope.iv, 'base64');
      const ct = Buffer.from(envelope.ct, 'base64');
      
      if (iv.length !== this.IV_LENGTH) {
        throw new Error(`Invalid IV length: ${iv.length}`);
      }
      
      if (ct.length < this.TAG_LENGTH) {
        throw new Error(`Invalid ciphertext length: ${ct.length}`);
      }
    } catch (error) {
      throw new Error(`Invalid envelope format: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Rewrap DEKs for key rotation (without re-encrypting payload)
   */
  static rewrapDEK(
    oldWrappedDEK: Buffer, 
    oldKeyRef: string, 
    newKeyRef: string
  ): Buffer {
    try {
      // Unwrap with old KEK
      const dek = this.unwrapDEK(oldWrappedDEK, oldKeyRef);
      
      // Rewrap with new KEK
      const newWrappedDEK = this.wrapDEK(dek, newKeyRef);
      
      // Secure cleanup
      this.secureWipe(dek);
      
      return newWrappedDEK;
    } catch (error) {
      throw new Error(`DEK rewrap failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Secure memory cleanup (best effort in Node.js)
   */
  private static secureWipe(buffer: Buffer): void {
    if (buffer) {
      buffer.fill(0);
    }
  }

  /**
   * Get encryption metrics for monitoring
   */
  static getMetrics() {
    return {
      algorithm: this.ALGORITHM,
      dekLength: this.DEK_LENGTH,
      ivLength: this.IV_LENGTH,
      tagLength: this.TAG_LENGTH,
      currentVersion: 1
    };
  }
}

export default EnvelopeEncryptionUtil;