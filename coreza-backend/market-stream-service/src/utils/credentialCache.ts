import crypto from "crypto";
import Redis from "ioredis";
import { getRedisCache } from "../config/redis";
import { createLogger } from "./logger";

const logger = createLogger("CredentialCache");

interface L1Entry {
  credentials: any;
  expiresAt: number;
}

export class CredentialCache {
  private static instance: CredentialCache;

  private l1Cache = new Map<string, L1Entry>();
  private readonly L1_TTL_MS = 30_000;
  private readonly MAX_L1_SIZE = 500;

  private redis: Redis | null = null;
  private readonly L2_TTL_SECONDS = 300;
  private readonly L2_PREFIX = "cred:";

  private sessionKey: Buffer | null = null;
  private sessionKeyExpiry = 0;

  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startCleanupTimer();
  }

  static getInstance(): CredentialCache {
    if (!CredentialCache.instance) {
      CredentialCache.instance = new CredentialCache();
    }
    return CredentialCache.instance;
  }

  static buildKey(userId: string, serviceType: string, name?: string): string {
    return `${userId}:${serviceType}:${name || "_default"}`;
  }

  private ensureRedis(): Redis {
    if (!this.redis) {
      this.redis = getRedisCache();
    }
    return this.redis;
  }

  private getSessionKey(): Buffer {
    const now = Date.now();
    if (this.sessionKey && this.sessionKeyExpiry > now) {
      return this.sessionKey;
    }

    const masterKey = process.env.COREZA_ENCRYPTION_KEY;
    if (!masterKey) throw new Error("COREZA_ENCRYPTION_KEY not set");

    const today = new Date().toISOString().split("T")[0];
    const salt = Buffer.from(`coreza-session-${today}`, "utf8");
    const info = Buffer.from("credential-cache-v1", "utf8");

    const derived = crypto.hkdfSync("sha256", Buffer.from(masterKey, "base64"), salt, info, 32);
    this.sessionKey = Buffer.from(derived);

    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    this.sessionKeyExpiry = tomorrow.getTime();

    logger.info("Session key derived for L2 Redis encryption");
    return this.sessionKey;
  }

  private encryptForRedis(data: any): string {
    const key = this.getSessionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const plaintext = JSON.stringify(data);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, encrypted, tag]).toString("base64");
  }

  private decryptFromRedis(encrypted: string): any {
    const key = this.getSessionKey();
    const combined = Buffer.from(encrypted, "base64");

    const iv = combined.subarray(0, 12);
    const tag = combined.subarray(-16);
    const ciphertext = combined.subarray(12, -16);

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  }

  async get(userId: string, serviceType: string, name?: string): Promise<any | null> {
    const key = CredentialCache.buildKey(userId, serviceType, name);

    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && l1Entry.expiresAt > Date.now()) {
      logger.debug({ key }, "L1 cache HIT");
      return l1Entry.credentials;
    }
    if (l1Entry) this.l1Cache.delete(key);

    try {
      const redis = this.ensureRedis();
      const encrypted = await redis.get(`${this.L2_PREFIX}${key}`);

      if (encrypted) {
        const credentials = this.decryptFromRedis(encrypted);
        this.setL1(key, credentials);
        logger.debug({ key }, "L2 cache HIT → L1 populated");
        return credentials;
      }
    } catch (error) {
      logger.warn({ key, error }, "L2 cache read failed, falling through to L3");
    }

    logger.debug({ key }, "Cache MISS (L1 + L2)");
    return null;
  }

  async set(userId: string, serviceType: string, name: string | undefined, credentials: any): Promise<void> {
    const key = CredentialCache.buildKey(userId, serviceType, name);
    this.setL1(key, credentials);

    try {
      const redis = this.ensureRedis();
      const encrypted = this.encryptForRedis(credentials);
      await redis.setex(`${this.L2_PREFIX}${key}`, this.L2_TTL_SECONDS, encrypted);
      logger.debug({ key }, "Cached in L1 + L2");
    } catch (error) {
      logger.warn({ key, error }, "L2 cache write failed (L1 still populated)");
    }
  }

  private setL1(key: string, credentials: any): void {
    if (this.l1Cache.size >= this.MAX_L1_SIZE) {
      const firstKey = this.l1Cache.keys().next().value;
      if (firstKey) this.l1Cache.delete(firstKey);
    }

    this.l1Cache.set(key, {
      credentials,
      expiresAt: Date.now() + this.L1_TTL_MS,
    });
  }

  async invalidate(userId: string, serviceType?: string, name?: string): Promise<void> {
    const redis = this.ensureRedis();

    if (!serviceType) {
      const pattern = `${this.L2_PREFIX}${userId}:*`;
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }

      for (const key of this.l1Cache.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this.l1Cache.delete(key);
        }
      }

      logger.info({ userId, keysRemoved: keys.length }, "Invalidated all user credentials");
    } else {
      const key = CredentialCache.buildKey(userId, serviceType, name);
      this.l1Cache.delete(key);
      await redis.del(`${this.L2_PREFIX}${key}`);

      logger.info({ key }, "Invalidated credential");
    }
  }

  getStats(): { l1Size: number; l1MaxSize: number } {
    return {
      l1Size: this.l1Cache.size,
      l1MaxSize: this.MAX_L1_SIZE,
    };
  }

  startCleanupTimer(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.l1Cache.entries()) {
        if (entry.expiresAt <= now) {
          this.l1Cache.delete(key);
        }
      }
    }, 30_000);
  }

  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export default CredentialCache;
