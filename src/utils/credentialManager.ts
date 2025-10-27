/**
 * Frontend Credential Manager - Encryption and Storage Only
 * Handles client-side encryption and direct database storage
 */

import { supabase } from "@/integrations/supabase/client";

// ----- Helpers -----
const getEnvKey = (): string | undefined => {
  // Vite (browser)
  // For Next.js client, replace with: process.env.NEXT_PUBLIC_COREZA_ENCRYPTION_KEY
  return import.meta.env?.VITE_COREZA_ENCRYPTION_KEY;
};

const base64ToBytes = (b64: string): Uint8Array => {
  // tolerate URL-safe base64 and missing padding
  let s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const tryBase64Key = (raw: string | undefined): Uint8Array | null => {
  if (!raw) return null;
  try {
    const bytes = base64ToBytes(raw);
    if (bytes.length === 16 || bytes.length === 32) return bytes;
    return null;
  } catch {
    return null;
  }
};

// === Add this helper ===
async function deriveUserKeyHKDF(
  masterKeyB64: string,
  userId: string,
  context: string
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  // master key is Base64 (same as backend expects)
  const masterKeyBytes = Uint8Array.from(atob(masterKeyB64), (c) =>
    c.charCodeAt(0)
  );

  // Import key material for HKDF
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    masterKeyBytes,
    "HKDF",
    false,
    ["deriveKey"]
  );

  const salt = enc.encode(`coreza-salt-${userId}`); // MUST match backend
  const info = enc.encode(`coreza-${context}-v1`); // MUST match backend

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 }, // 256-bit (AES-256-GCM)
    false,
    ["encrypt", "decrypt"]
  );
}

// Client-side encryption utility using Web Crypto API
class ClientEncryption {
  // Replace your old getEncryptionKey with this version
  private static async getEncryptionKey(userId: string): Promise<CryptoKey> {
    try {
      // Vite – exposed to browser; for Next use process.env.NEXT_PUBLIC_COREZA_ENCRYPTION_KEY
      const masterKeyB64 = import.meta.env.VITE_COREZA_ENCRYPTION_KEY;
      if (!masterKeyB64) {
        throw new Error("VITE_COREZA_ENCRYPTION_KEY (Base64) missing");
      }
      // Derive per-user AES-256 key via HKDF to match backend
      return await deriveUserKeyHKDF(masterKeyB64, userId, "credentials");
    } catch (error) {
      console.error("Error getting encryption key:", error);
      throw new Error(
        `Failed to initialize encryption: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  static async encrypt(
    userId: string,
    data: any
  ): Promise<{
    enc_payload: string;
    iv: string;
    auth_tag: string;
  }> {
    try {
      const key = await this.getEncryptionKey(userId);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(JSON.stringify(data));

      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        dataBuffer
      );

      // Web Crypto AES-GCM returns ciphertext||authTag
      const encryptedArray = new Uint8Array(encrypted);
      const ciphertext = encryptedArray.slice(0, -16);
      const authTag = encryptedArray.slice(-16);

      return {
        enc_payload: btoa(String.fromCharCode(...ciphertext)),
        iv: btoa(String.fromCharCode(...iv)),
        auth_tag: btoa(String.fromCharCode(...authTag)),
      };
    } catch (error) {
      console.error("Encryption error:", error);
      throw new Error("Failed to encrypt data");
    }
  }

  static async decrypt(
    userId: string,
    encPayload: string,
    iv: string,
    authTag: string
  ): Promise<any> {
    try {
      const key = await this.getEncryptionKey(userId);

      const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
      const ciphertextBytes = Uint8Array.from(atob(encPayload), (c) =>
        c.charCodeAt(0)
      );
      const authTagBytes = Uint8Array.from(atob(authTag), (c) =>
        c.charCodeAt(0)
      );

      const encryptedBuffer = new Uint8Array(
        ciphertextBytes.length + authTagBytes.length
      );
      encryptedBuffer.set(ciphertextBytes);
      encryptedBuffer.set(authTagBytes, ciphertextBytes.length);

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: ivBytes },
        key,
        encryptedBuffer
      );

      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(decrypted));
    } catch (error) {
      console.error("Decryption error:", error);
      throw new Error("Failed to decrypt data");
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
    if (!userId || !serviceType || !credentialName || !credentials) {
      throw new Error("Missing required parameters");
    }

    const sanitizedServiceType = serviceType.replace(/[^a-zA-Z0-9_-]/g, "");
    const sanitizedCredentialName = credentialName.substring(0, 100);

    try {
      console.log(
        `🔐 Encrypting credentials for ${sanitizedServiceType}:${sanitizedCredentialName}`
      );

      // 🔴 Pass userId here so HKDF derivation matches backend
      const encryptedCredentials = await ClientEncryption.encrypt(
        userId,
        credentials
      );

      const { error } = await supabase.from("user_credentials").upsert(
        {
          user_id: userId,
          service_type: sanitizedServiceType,
          name: sanitizedCredentialName,
          enc_payload: `\\x${Array.from(
            atob(encryptedCredentials.enc_payload),
            (c) => c.charCodeAt(0).toString(16).padStart(2, "0")
          ).join("")}`,
          iv: `\\x${Array.from(atob(encryptedCredentials.iv), (c) =>
            c.charCodeAt(0).toString(16).padStart(2, "0")
          ).join("")}`,
          auth_tag: `\\x${Array.from(atob(encryptedCredentials.auth_tag), (c) =>
            c.charCodeAt(0).toString(16).padStart(2, "0")
          ).join("")}`,
          is_encrypted: true,
          enc_version: 2,
          key_ref: "user:v2",
          key_algo: "AES-256-GCM", // if you must reflect 128 vs 256, detect based on key length where you import the key
          scopes: scopes?.substring(0, 255),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,service_type,name" }
      );

      if (error) {
        console.error("Error storing credentials:", error);
        throw new Error(`Failed to store credentials: ${error.message}`);
      }

      console.log(
        `✅ Successfully stored encrypted credentials for ${sanitizedServiceType}:${sanitizedCredentialName}`
      );
    } catch (error) {
      console.error("Error storing credentials:", error);
      throw error;
    }
  }

  /**
   * Delete a credential
   */
  static async deleteCredential(
    userId: string,
    credentialId: string
  ): Promise<void> {
    if (!userId || !credentialId) {
      throw new Error("Missing required parameters");
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(credentialId)) {
      throw new Error("Invalid credential ID format");
    }

    try {
      const { error } = await supabase
        .from("user_credentials")
        .delete()
        .eq("id", credentialId)
        .eq("user_id", userId);

      if (error) {
        console.error("Error deleting credential:", error);
        throw new Error(`Failed to delete credential: ${error.message}`);
      }

      console.log(`🗑️ Successfully deleted credential ${credentialId}`);
    } catch (error) {
      console.error("Error deleting credential:", error);
      throw error;
    }
  }
}

export default CredentialManager;
