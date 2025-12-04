/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Enhanced Credential Manager with envelope encryption support
 * Provides dual-read capability and secure migration path
 */

import crypto from "crypto";
import { supabase } from "../config/supabase";
import EnvelopeEncryptionUtil from "./envelopeEncryption";
import DecryptionUtil from "./decryption";
import { CredentialValidator } from "./credentialValidator";
import ClientEncryption from "./ClientEncryption"; // ⬅️ ensure this exists (frontend-style encryptor)

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
    return Buffer.isBuffer(derivedKey)
      ? derivedKey
      : Buffer.from(derivedKey);
  }

  /** Decrypt AES-256-GCM payload where encryptedData = base64(IV(12) + CIPHERTEXT + TAG(16)) */
  private static async decryptClientData(
    encryptedData: string,
    encryptionKeyB64: string
  ): Promise<any> {
    try {
      const combined = Buffer.from(encryptedData, "base64");
      const iv = combined.subarray(0, 12);
      const ciphertext = combined.subarray(12, -16);
      const tag = combined.subarray(-16);

      const key = Buffer.from(encryptionKeyB64, "base64");
      if (key.length !== 32) {
        throw new Error(
          `Invalid key length: ${key.length} (expected 32 for AES-256)`
        );
      }

      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const out = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return JSON.parse(out.toString("utf8"));
    } catch {
      throw new Error("Failed to decrypt client data");
    }
  }

  /** Decrypt enc_version=2 (separate base64 fields) using HKDF-derived user key */
  private static async decryptFrontendData(
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
    credentialName?: string
  ): Promise<{ credentials?: any; error?: string }> {
    try {
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

      // Legacy single-field client_json (string: base64(iv+cipher+tag))
      if (
        credential.client_json &&
        typeof credential.client_json === "string"
      ) {
        try {
          const encryptionKey = process.env.COREZA_ENCRYPTION_KEY;
          if (!encryptionKey) throw new Error("Encryption key not available");
          const creds = await this.decryptClientData(
            credential.client_json,
            encryptionKey
          );
          return { credentials: creds };
        } catch (e) {
          console.error("Failed to decrypt client_json:", e);
          return { error: "Failed to decrypt credentials" };
        }
      }

      // Frontend v2 format (separate bytea/base64 fields)
      if (
        credential.is_encrypted &&
        credential.enc_version === 2 &&
        credential.key_ref === "user:v2"
      ) {
        try {
          const encPayload = this.bufferToBase64(credential.enc_payload);
          const iv = this.bufferToBase64(credential.iv);
          const authTag = this.bufferToBase64(credential.auth_tag);
          const creds = await this.decryptFrontendData(
            userId,
            encPayload,
            iv,
            authTag
          );
          return { credentials: creds };
        } catch (e: any) {
          console.error("Failed to decrypt frontend data:", e);
          return { error: `Frontend decryption failed: ${e.message}` };
        }
      }

      // Envelope v1 (backend)
      if (
        credential.is_encrypted &&
        credential.enc_payload &&
        credential.enc_version === 1
      ) {
        try {
          const payload = EnvelopeEncryptionUtil.decrypt({
            encPayload: credential.enc_payload,
            iv: credential.iv,
            authTag: credential.auth_tag,
            dekWrapped: credential.dek_wrapped,
            keyRef: credential.key_ref || "env:v1",
            userId,
            credentialId: credential.id,
          });
          return { credentials: { ...payload.client, ...payload.token } };
        } catch (e) {
          console.error("Failed envelope decryption:", e);
          return { error: "Failed to decrypt envelope credentials" };
        }
      }

      return { error: "No valid credential data found" };
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

          if (record.is_encrypted && record.enc_payload) {
            // Envelope or v2 (decide by version)
            if (record.enc_version === 2 && record.key_ref === "user:v2") {
              console.log(
                `🔓 Decrypting v2 (frontend) ${record.service_type}:${record.name}`
              );
              const encPayload = this.bufferToBase64(record.enc_payload);
              const iv = this.bufferToBase64(record.iv);
              const tag = this.bufferToBase64(record.auth_tag);
              credentials = await this.decryptFrontendData(
                userId,
                encPayload,
                iv,
                tag
              );
            } else {
              console.log(
                `🔓 Decrypting envelope ${record.service_type}:${record.name}`
              );
              const payload = EnvelopeEncryptionUtil.decrypt({
                encPayload: record.enc_payload,
                iv: record.iv,
                authTag: record.auth_tag,
                dekWrapped: record.dek_wrapped,
                keyRef: record.key_ref || "env:v1",
                userId,
                credentialId: record.id,
              });
              credentials = { ...payload.client, ...payload.token };
            }
          } else {
            // Legacy JSON fields
            console.log(
              `🔓 Decrypting legacy ${record.service_type}:${record.name}`
            );
            const clientJson = record.client_json as Record<
              string,
              string
            > | null;
            const tokenJson = record.token_json as Record<
              string,
              string
            > | null;

            credentials = {};
            if (clientJson && typeof clientJson === "object") {
              for (const [k, v] of Object.entries(clientJson)) {
                credentials[k] =
                  typeof v === "string" && DecryptionUtil.isEncrypted(v)
                    ? await DecryptionUtil.decrypt(v)
                    : v;
              }
            }
            if (tokenJson && typeof tokenJson === "object") {
              for (const [k, v] of Object.entries(tokenJson)) {
                credentials[k] =
                  typeof v === "string" && DecryptionUtil.isEncrypted(v)
                    ? await DecryptionUtil.decrypt(v)
                    : v;
              }
            }
          }

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
    credentialName: string
  ): Promise<{
    credentials: {
      client_json: Record<string, any>;
      token_json: Record<string, any>;
    } | null;
  }> {
    try {
      const { data, error } = await supabase
        .from("user_credentials")
        .select("*")
        .eq("user_id", userId)
        .eq("name", credentialName)
        .eq("service_type", serviceType)
        .single();

      if (error || !data) return { credentials: null };

      let decrypted: Record<string, any> = {};

      if (data.is_encrypted) {
        if (data.enc_version === 2 && data.key_ref === "user:v2") {
          console.log(`🔓 Decrypt v2 (frontend) for ${serviceType}`);
          const res = await this.getDecryptedCredentials(
            userId,
            serviceType,
            data.name
          );
          if (res.error) throw new Error(res.error);
          if (!res.credentials)
            throw new Error("Decrypted credentials not available");
          decrypted = res.credentials;
        } else if (data.enc_payload) {
          console.log(`🔓 Decrypt envelope for ${serviceType}`);
          const payload = EnvelopeEncryptionUtil.decrypt({
            encPayload: data.enc_payload,
            iv: data.iv,
            authTag: data.auth_tag,
            dekWrapped: data.dek_wrapped,
            keyRef: data.key_ref || "env:v1",
            userId,
            credentialId: data.id,
          });
          decrypted = { ...payload.client, ...payload.token };
        }
      } else {
        console.log(`🔓 Decrypt legacy for ${serviceType}`);
        const client = { ...(data.client_json || {}) };
        const token = { ...(data.token_json || {}) };

        const sensitive = [
          "api_key",
          "secret_key",
          "access_token",
          "refresh_token",
          "client_secret",
        ];

        for (const f of sensitive) {
          if (client[f] && DecryptionUtil.isEncrypted(client[f])) {
            client[f] = await DecryptionUtil.decrypt(client[f]);
          }
          if (token[f] && DecryptionUtil.isEncrypted(token[f])) {
            token[f] = await DecryptionUtil.decrypt(token[f]);
          }
        }

        decrypted = { ...client, ...token };
      }

      const validation = CredentialValidator.validateCredentials(
        serviceType,
        decrypted
      );
      if (!validation.isValid) {
        throw new Error(
          `Invalid ${serviceType} credentials: ${validation.errors.join(", ")}`
        );
      }
      if (validation.warnings.length > 0) {
        console.warn(
          `${serviceType} credential warnings:`,
          validation.warnings
        );
      }

      return { credentials: { client_json: decrypted, token_json: {} } };
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
    await this.storeCredentials(userId, serviceType, credentialName, credentials, scopes);

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
    const migrationProgress = total === 0 ? 0 : Math.round((encrypted / total) * 100);

    return { total, encrypted, migrationProgress };
  }
}

export default CredentialManager;
