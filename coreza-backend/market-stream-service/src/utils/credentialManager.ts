/**
 * Enhanced Credential Manager with envelope encryption support
 * Provides dual-read capability and secure migration path
 */

import crypto from "crypto";
import { supabase } from "../config/supabase";
import ClientEncryption from "./ClientEncryption";
import CredentialCache from "./credentialCache";

export interface UserCredential {
  id: string;
  name: string;
  service_type: string;
  created_at: string;
  updated_at: string;
  is_encrypted: boolean;
  enc_version?: number;
  key_ref?: string;
}

export interface DecryptedCredential extends UserCredential {
  credentials: Record<string, any>;
}

export interface CredentialPayload {
  service_type: string;
  name: string;
  client: Record<string, any>;
  token: Record<string, any>;
  scopes?: string;
  meta?: {
    migrated_from_plaintext?: boolean;
    migrated_at?: string;
    created_with_envelope?: boolean;
  };
}

class CredentialManager {
  // --------------------------------------
  // Helpers
  // --------------------------------------

  /** Convert Supabase bytea (\\xHEX) or Buffer object → base64 string */
  private static bufferToBase64(buffer: any): string {
    if (!buffer) return "";

    if (typeof buffer === "string") {
      // bytea style: "\xDEADBEEF..."
      if (buffer.startsWith("\\x")) {
        const hex = buffer.slice(2);
        return Buffer.from(hex, "hex").toString("base64");
      }
      return buffer; // already a base64 or plain string
    }

    if (buffer?.type === "Buffer" && Array.isArray(buffer.data)) {
      // Some clients return { type: 'Buffer', data: [...] }
      const bytes = Buffer.from(buffer.data);
      const str = bytes.toString("utf8");
      if (str.startsWith("\\x")) {
        const hex = str.slice(2);
        return Buffer.from(hex, "hex").toString("base64");
      }
      // If it was raw binary, return base64
      return bytes.toString("base64");
    }

    // Fallback
    return String(buffer);
  }

  /** base64 → Postgres bytea hex literal */
  private static b64ToPgHex(b64: string): string {
    return `\\x${Buffer.from(b64, "base64").toString("hex")}`;
    // Note: store in a BYTEA column
  }

  /** HKDF-SHA256 derive 32-byte key from master (base64) and user scope */
  private static async deriveUserKey(
    masterKey: string,
    userId: string,
    context: string
  ): Promise<Buffer> {
    const salt = Buffer.from(`coreza-salt-${userId}`, "utf8");
    const info = Buffer.from(`coreza-${context}-v1`, "utf8");
    const keyMaterial = Buffer.from(masterKey, "base64");
    const derivedKey = crypto.hkdfSync(
      "sha256",
      keyMaterial,
      salt,
      info,
      32
    ) as Buffer | ArrayBuffer;
    return Buffer.isBuffer(derivedKey) ? derivedKey : Buffer.from(derivedKey);
  }

  /** Decrypt enc_version=2 (separate base64 fields) using HKDF-derived user key */
  private static async decryptData(
    userId: string,
    encPayloadB64: string,
    ivB64: string,
    tagB64: string
  ): Promise<any> {
    try {
      const masterKey = process.env.COREZA_ENCRYPTION_KEY;
      if (!masterKey) throw new Error("Encryption key not available");

      const keyBuffer = await this.deriveUserKey(
        masterKey,
        userId,
        "credentials"
      );
      if (keyBuffer.byteLength !== 32) {
        throw new Error(
          `Invalid derived key length: ${keyBuffer.byteLength} (expected 32)`
        );
      }

      const iv = Buffer.from(ivB64, "base64");
      const tag = Buffer.from(tagB64, "base64");
      const ciphertext = Buffer.from(encPayloadB64, "base64");

      if (iv.length !== 12) throw new Error(`Invalid IV length: ${iv.length}`);
      if (tag.length !== 16)
        throw new Error(`Invalid auth tag length: ${tag.length}`);
      if (ciphertext.length < 1) throw new Error("Ciphertext too short");

      const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
      decipher.setAuthTag(tag);
      const out = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return JSON.parse(out.toString("utf8"));
    } catch (err: any) {
      throw new Error(
        `Failed to decrypt frontend data: ${err?.message ?? "Unknown error"}`
      );
    }
  }

  // --------------------------------------
  // Reads
  // --------------------------------------

  /**
   * Get decrypted credentials (single). Use when executing a service.
   */
  static async getDecryptedCredentials(
    userId: string,
    serviceType: string,
    credentialName?: string,
    options?: {
      useCache?: boolean;
    }
  ): Promise<{ credentials?: any; created_at?: string; error?: string }> {
    try {
      const useCache = options?.useCache ?? true;

      if (useCache) {
        const cache = CredentialCache.getInstance();
        const cached = await cache.get(userId, serviceType, credentialName);
        if (cached !== null) {
          console.log(
            `📦 Cache HIT: ${serviceType}:${credentialName || "_default"}`
          );
          return { credentials: cached };
        }
      } else {
        console.log(
          `📦 Cache BYPASS: ${serviceType}:${credentialName || "_default"}`
        );
      }

      console.log(
        `📦 Cache MISS: ${serviceType}:${credentialName || "_default"}`
      );

      let query = supabase
        .from("user_credentials")
        .select("*")
        .eq("user_id", userId)
        .eq("service_type", serviceType)
        .order("updated_at", { ascending: false });

      if (credentialName) query = query.eq("name", credentialName);

      const { data, error } = await query;
      if (error)
        return { error: `Failed to fetch credentials: ${error.message}` };
      if (!data || data.length === 0) return { error: "Credentials not found" };
      if (!credentialName && data.length > 1) {
        return { error: "Multiple credentials found; specify credentialName" };
      }

      const credential = data[0];
      let credentials: any | null = null;

      // Legacy single-field client_json (string: base64(iv+cipher+tag))
      if (
        // Frontend v2 format (separate bytea/base64 fields)
        credential.is_encrypted &&
        credential.enc_version === 2 &&
        credential.key_ref === "user:v2"
      ) {
        try {
          const encPayload = this.bufferToBase64(credential.enc_payload);
          const iv = this.bufferToBase64(credential.iv);
          const authTag = this.bufferToBase64(credential.auth_tag);
          credentials = await this.decryptData(userId, encPayload, iv, authTag);
        } catch (e: any) {
          console.error("Failed to decrypt frontend data:", e);
          return { error: `Frontend decryption failed: ${e.message}` };
        }
      }

      if (!credentials) return { error: "No valid credential data found" };

      if (useCache) {
        await CredentialCache.getInstance().set(
          userId,
          serviceType,
          credentialName,
          credentials
        );
      }
      return { credentials, created_at: credential.created_at };
    } catch (error: any) {
      return { error: error?.message ?? "Unknown error" };
    }
  }

  /**
   * Retrieve and decrypt multiple records (for management UI).
   */
  static async getCredentialRecords(
    userId: string,
    serviceType: string,
    credentialName?: string
  ): Promise<DecryptedCredential[]> {
    try {
      let query = supabase
        .from("user_credentials")
        .select("*")
        .eq("user_id", userId)
        .eq("service_type", serviceType)
        .order("updated_at", { ascending: false });

      if (credentialName) query = query.eq("name", credentialName);

      const { data, error } = await query;
      if (error) throw new Error("Failed to fetch credentials");
      if (!data || data.length === 0) return [];

      const out: DecryptedCredential[] = [];

      for (const record of data) {
        try {
          let credentials: Record<string, any>;

          console.log(
            `🔓 Decrypting v2 (frontend) ${record.service_type}:${record.name}`
          );
          const encPayload = this.bufferToBase64(record.enc_payload);
          const iv = this.bufferToBase64(record.iv);
          const tag = this.bufferToBase64(record.auth_tag);
          credentials = await this.decryptData(userId, encPayload, iv, tag);

          out.push({
            id: record.id,
            name: record.name,
            service_type: record.service_type,
            created_at: record.created_at,
            updated_at: record.updated_at,
            is_encrypted: !!record.is_encrypted,
            enc_version: record.enc_version,
            key_ref: record.key_ref,
            credentials,
          });
        } catch (e) {
          console.error(`Failed to decrypt credential ${record.id}:`, e);
          // continue to next
        }
      }

      return out;
    } catch (e) {
      console.error("Error in getCredentialRecords:", e);
      throw e;
    }
  }

  /**
   * Retrieve a specific credential pair in unified shape.
   */
  static async getCredentials(
    userId: string,
    serviceType: string,
    credentialName: string,
    options?: {
      useCache?: boolean;
    }
  ): Promise<{
    credentials: {
      client_json: Record<string, any>;
      token_json: Record<string, any>;
    } | null;
    created_at?: string;
  }> {
    try {
      const useCache = options?.useCache ?? true;

      if (useCache) {
        const cache = CredentialCache.getInstance();
        const cached = await cache.get(userId, serviceType, credentialName);
        if (cached !== null) {
          console.log(`📦 Cache HIT: ${serviceType}:${credentialName}`);
          return { credentials: { client_json: cached, token_json: {} } };
        }
      } else {
        console.log(`📦 Cache BYPASS: ${serviceType}:${credentialName}`);
      }

      console.log(`📦 Cache MISS: ${serviceType}:${credentialName}`);
      const result = await this.getDecryptedCredentials(
        userId,
        serviceType,
        credentialName,
        { useCache }
      );

      if (result.error || !result.credentials) {
        return { credentials: null };
      }

      return {
        credentials: { client_json: result.credentials, token_json: {} },
        created_at: result.created_at,
      };
    } catch (e: any) {
      throw new Error(
        `Failed to get ${serviceType} credentials: ${
          e?.message ?? "Unknown error"
        }`
      );
    }
  }

  // --------------------------------------
  // Writes / Admin
  // --------------------------------------

  /**
   * Store credentials (v2, user-scoped AES-256-GCM via HKDF).
   * Expects ClientEncryption.encrypt(userId, credentials) -> { enc_payload, iv, auth_tag } (base64 strings)
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

      const encrypted = await ClientEncryption.encrypt(userId, credentials);
      const { enc_payload, iv, auth_tag } = encrypted;

      const { error } = await supabase.from("user_credentials").upsert(
        {
          user_id: userId,
          service_type: sanitizedServiceType,
          name: sanitizedCredentialName,
          enc_payload: this.b64ToPgHex(enc_payload),
          iv: this.b64ToPgHex(iv),
          auth_tag: this.b64ToPgHex(auth_tag),
          is_encrypted: true,
          enc_version: 2,
          key_ref: "user:v2",
          key_algo: "AES-256-GCM",
          scopes: scopes?.substring(0, 255),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,service_type,name" }
      );

      if (error) {
        throw new Error(`Failed to store credentials: ${error.message}`);
      }

      // Invalidate cache after successful store
      await CredentialCache.getInstance().invalidate(
        userId,
        sanitizedServiceType,
        sanitizedCredentialName
      );
      console.log(
        `✅ Successfully stored encrypted credentials for ${sanitizedServiceType}:${sanitizedCredentialName}`
      );
    } catch (e) {
      console.error("Error storing credentials:", e);
      throw e;
    }
  }

  /**
   * Backwards compatible helper that stores credentials and returns the row id.
   * Some legacy routes expect a credential_id back after saving.
   */
  static async saveCredentials(
    userId: string,
    serviceType: string,
    credentialName: string,
    credentials: any,
    scopes?: string
  ): Promise<string> {
    await this.storeCredentials(
      userId,
      serviceType,
      credentialName,
      credentials,
      scopes
    );

    const { data, error } = await supabase
      .from("user_credentials")
      .select("id")
      .eq("user_id", userId)
      .eq("service_type", serviceType)
      .eq("name", credentialName)
      .single();

    if (error || !data) {
      throw new Error("Failed to retrieve credential id after saving");
    }

    return data.id;
  }

  static async deleteCredential(
    userId: string,
    credentialId: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from("user_credentials")
        .delete()
        .eq("user_id", userId)
        .eq("id", credentialId);

      if (error) throw new Error("Failed to delete credential");

      // Invalidate all cache for user after delete
      await CredentialCache.getInstance().invalidate(userId);
      console.log(`🗑️ Deleted credential ${credentialId}`);
    } catch (e) {
      console.error("Error in deleteCredential:", e);
      throw e;
    }
  }

  static async listCredentials(
    userId: string,
    serviceType?: string
  ): Promise<UserCredential[]> {
    try {
      let q = supabase
        .from("user_credentials")
        .select(
          "id, name, service_type, created_at, updated_at, is_encrypted, enc_version, key_ref"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (serviceType) q = q.eq("service_type", serviceType);

      const { data, error } = await q;
      if (error) throw new Error("Failed to list credentials");
      return data || [];
    } catch (e) {
      console.error("Error in listCredentials:", e);
      throw e;
    }
  }

  /**
   * Migrate a single credential record to envelope encryption. This is a
   * best-effort migration that reads the existing JSON payload, re-encrypts it
   * using the same helper used for new writes and stores the encrypted fields.
   */
  static async migrateCredential(
    credentialId: string,
    userId: string,
    serviceType: string,
    credentialName: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase
        .from("user_credentials")
        .select("*")
        .eq("id", credentialId)
        .eq("user_id", userId)
        .eq("service_type", serviceType)
        .eq("name", credentialName)
        .single();

      if (error || !data) {
        return { success: false, error: "Credential not found" };
      }

      if (data.enc_payload && data.iv && data.auth_tag) {
        return { success: true };
      }

      const mergedPayload = {
        ...(data.client_json || {}),
        ...(data.token_json || {}),
      };

      if (Object.keys(mergedPayload).length === 0) {
        return {
          success: false,
          error: "Credential has no client/token data to migrate",
        };
      }

      const encrypted = await ClientEncryption.encrypt(userId, mergedPayload);

      const { error: updateError } = await supabase
        .from("user_credentials")
        .update({
          enc_payload: this.b64ToPgHex(encrypted.enc_payload),
          iv: this.b64ToPgHex(encrypted.iv),
          auth_tag: this.b64ToPgHex(encrypted.auth_tag),
          enc_version: 2,
          key_ref: "user:v2",
          is_encrypted: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", credentialId)
        .eq("user_id", userId);

      if (updateError) {
        return {
          success: false,
          error: `Failed to update credential: ${updateError.message}`,
        };
      }

      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message ?? "Failed to migrate credential",
      };
    }
  }

  /**
   * Batch migrate all credentials that belong to a user.
   */
  static async batchMigrateUser(userId: string): Promise<{
    success: boolean;
    migrated: number;
    failed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let migrated = 0;
    let failed = 0;

    const { data, error } = await supabase
      .from("user_credentials")
      .select("id, service_type, name")
      .eq("user_id", userId);

    if (error || !data) {
      return {
        success: false,
        migrated: 0,
        failed: 0,
        errors: [error?.message || "Failed to fetch credentials"],
      };
    }

    for (const record of data) {
      const result = await this.migrateCredential(
        record.id,
        userId,
        record.service_type,
        record.name
      );
      if (result.success) {
        migrated += 1;
      } else {
        failed += 1;
        if (result.error) {
          errors.push(`${record.name}: ${result.error}`);
        }
      }
    }

    return { success: errors.length === 0, migrated, failed, errors };
  }

  /**
   * Return a simple summary of how many credentials have already been migrated.
   */
  static async getMigrationStatus(userId: string): Promise<{
    total: number;
    encrypted: number;
    migrationProgress: number;
  }> {
    const { data, error } = await supabase
      .from("user_credentials")
      .select("enc_payload, iv, auth_tag")
      .eq("user_id", userId);

    if (error || !data || data.length === 0) {
      return { total: 0, encrypted: 0, migrationProgress: 0 };
    }

    const encrypted = data.filter(
      (record) => record.enc_payload && record.iv && record.auth_tag
    ).length;
    const total = data.length;
    const migrationProgress =
      total === 0 ? 0 : Math.round((encrypted / total) * 100);

    return { total, encrypted, migrationProgress };
  }
}

export default CredentialManager;
