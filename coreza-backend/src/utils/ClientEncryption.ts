// ClientEncryption.ts
// Browser/Web Crypto only. Matches server: HKDF(SHA-256) + AES-256-GCM
// Triplet I/O: { enc_payload, iv, auth_tag } as base64 strings.

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Base64 helpers (browser) */
function b64FromBytes(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function bytesFromB64(b64: string): Uint8Array {
  if (!b64) throw new Error("Missing base64 input.");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * HKDF derivation (SHA-256) to match server:
 * salt = `coreza-salt-${userId}`
 * info = `coreza-${context}-v1`
 * masterKeyB64 is the SAME base64 key the backend uses (COREZA_ENCRYPTION_KEY)
 */
export async function deriveUserKeyHKDF(
  masterKeyB64: string,
  userId: string,
  context: string
): Promise<CryptoKey> {
  if (!userId) throw new Error("userId is required for HKDF.");
  if (!masterKeyB64)
    throw new Error("Master key (base64) is required for HKDF.");

  const masterRaw = Uint8Array.from(atob(masterKeyB64), (c) => c.charCodeAt(0));
  if (masterRaw.byteLength === 0)
    throw new Error("Master key is empty after base64 decode.");

  const masterKey = await crypto.subtle.importKey(
    "raw",
    masterRaw,
    "HKDF",
    false,
    ["deriveKey"]
  );
  const salt = textEncoder.encode(`coreza-salt-${userId}`);
  const info = textEncoder.encode(`coreza-${context}-v1`);

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

class ClientEncryption {
  /**
   * Per-user AES-256 key via HKDF; master key must match server env.
   * Env precedence (frontend-only):
   *  - Vite:       import.meta.env.VITE_COREZA_ENCRYPTION_KEY (RECOMMENDED)
   *  - Next (pub): process.env.NEXT_PUBLIC_COREZA_ENCRYPTION_KEY (fallback if exposed)
   */
  private static getEncryptionKey(userId: string): Buffer {
    const masterKeyB64 = process.env.COREZA_ENCRYPTION_KEY;
    if (!masterKeyB64) {
      throw new Error("COREZA_ENCRYPTION_KEY (base64) missing in backend env");
    }
    return deriveUserKeyHKDF(masterKeyB64, userId, "credentials");
  }

  /**
   * Encrypt JSON → { enc_payload, iv, auth_tag } (base64)
   * WebCrypto returns ciphertext||tag; we split and return separately.
   */
  static async encrypt(
    userId: string,
    data: any
  ): Promise<{ enc_payload: string; iv: string; auth_tag: string }> {
    if (userId == null || userId === "") throw new Error("userId is required.");
    const key = await this.getEncryptionKey(userId);

    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const plaintext = textEncoder.encode(JSON.stringify(data));

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext
    );
    const bytes = new Uint8Array(encrypted);

    if (bytes.length < 17) throw new Error("Ciphertext too short.");
    const ciphertext = bytes.slice(0, -16);
    const tag = bytes.slice(-16);

    return {
      enc_payload: b64FromBytes(ciphertext),
      iv: b64FromBytes(iv),
      auth_tag: b64FromBytes(tag),
    };
  }

  /**
   * Decrypt the triplet produced by `encrypt`
   */
  static async decrypt(
    userId: string,
    encPayloadB64: string,
    ivB64: string,
    authTagB64: string
  ): Promise<any> {
    if (userId == null || userId === "") throw new Error("userId is required.");
    const key = await this.getEncryptionKey(userId);

    const iv = bytesFromB64(ivB64);
    const ciphertext = bytesFromB64(encPayloadB64);
    const tag = bytesFromB64(authTagB64);

    if (iv.byteLength !== 12)
      throw new Error(`Invalid IV length: ${iv.byteLength} (expected 12).`);
    if (tag.byteLength !== 16)
      throw new Error(
        `Invalid auth tag length: ${tag.byteLength} (expected 16).`
      );
    if (ciphertext.byteLength < 1) throw new Error("Ciphertext too short.");

    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      combined
    );
    return JSON.parse(textDecoder.decode(decrypted));
  }
}

export default ClientEncryption;
export { ClientEncryption };
