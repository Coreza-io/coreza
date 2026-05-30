import { randomUUID } from "crypto";
import { getRedisCache } from "../config/redis";
import CredentialManager from "./credentialManager";
import {
  BrokerAuthError,
  getReconnectRequiredCode,
  isOAuthReconnectError,
} from "./brokerAuthError";
import {
  DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_SECONDS,
  DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS,
  isAccessTokenNearExpiry,
  isRefreshTokenExpired,
  unixNowSeconds,
} from "./oauthTokenLifecycle";

export interface OAuthRefreshProviderConfig {
  provider: string;
  tokenUrl: string;
  clientIdField: string;
  clientSecretField: string;
  refreshTokenField?: string;
  accessTokenField?: string;
  expiresInField?: string;
  accessTokenRefreshBufferSeconds?: number;
  refreshTokenLifetimeSeconds?: number;
  refreshLockTtlMs?: number;
  refreshLockPollAttempts?: number;
  refreshLockPollDelayMs?: number;
}

interface OAuthCredentials extends Record<string, unknown> {
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: number;
  refresh_token_created_at?: number;
  refresh_token_expires_at?: number;
  last_refreshed_at?: number;
}

interface FreshOAuthCredentials {
  credentials: OAuthCredentials;
  createdAt?: string;
}

const DEFAULT_REFRESH_LOCK_TTL_MS = 10_000;
const DEFAULT_REFRESH_LOCK_POLL_ATTEMPTS = 5;
const DEFAULT_REFRESH_LOCK_POLL_DELAY_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockKey(
  provider: string,
  userId: string,
  credentialId: string,
): string {
  const safeProvider = encodeURIComponent(provider.toLowerCase());
  const safeUserId = encodeURIComponent(userId);
  const safeCredentialId = encodeURIComponent(credentialId);
  return `${safeProvider}:token-refresh:${safeUserId}:${safeCredentialId}`;
}

async function getFreshCredentials(
  userId: string,
  credentialId: string,
  config: OAuthRefreshProviderConfig,
): Promise<FreshOAuthCredentials> {
  const provider = config.provider.toLowerCase();
  const result = await CredentialManager.getCredentials(
    userId,
    provider,
    credentialId,
    { useCache: false },
  );

  if (!result.credentials) {
    throw new Error(`${provider} credentials not found`);
  }

  return {
    credentials: {
      ...result.credentials.client_json,
      ...result.credentials.token_json,
    },
    createdAt: result.created_at,
  };
}

async function releaseLock(key: string, value: string): Promise<void> {
  const redis = getRedisCache();
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    value,
  );
}

function requireStringCredential(
  credentials: OAuthCredentials,
  field: string,
  provider: string,
): string {
  const value = credentials[field];
  if (typeof value !== "string" || !value) {
    throw new Error(`${provider} OAuth credentials are missing ${field}`);
  }
  return value;
}

async function refreshProviderToken(
  userId: string,
  credentialId: string,
  credentials: OAuthCredentials,
  config: OAuthRefreshProviderConfig,
): Promise<OAuthCredentials> {
  const provider = config.provider.toLowerCase();
  const refreshTokenField = config.refreshTokenField ?? "refresh_token";
  const accessTokenField = config.accessTokenField ?? "access_token";
  const expiresInField = config.expiresInField ?? "expires_in";
  const clientId = requireStringCredential(
    credentials,
    config.clientIdField,
    provider,
  );
  const clientSecret = requireStringCredential(
    credentials,
    config.clientSecretField,
    provider,
  );
  const refreshToken = requireStringCredential(
    credentials,
    refreshTokenField,
    provider,
  );

  const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodedCredentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      `${provider} token refresh failed with HTTP ${response.status}`,
    );
    Object.defineProperty(error, "status", { value: response.status });
    Object.defineProperty(error, "response", {
      value: { status: response.status, data: responseBody },
    });
    throw error;
  }

  const body = responseBody as Record<string, unknown>;
  const accessToken = body[accessTokenField];
  const expiresIn = body[expiresInField];
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    throw new Error(`${provider} token refresh response was missing token fields`);
  }

  const now = unixNowSeconds();
  const refreshed: OAuthCredentials = {
    ...credentials,
    access_token: accessToken,
    token_expires_at: now + expiresIn,
    last_refreshed_at: now,
  };

  await CredentialManager.storeCredentials(userId, provider, credentialId, refreshed);
  return refreshed;
}

export async function refreshOAuthTokenIfNeeded(
  credentials: OAuthCredentials,
  userId: string,
  credentialId: string,
  config: OAuthRefreshProviderConfig,
): Promise<OAuthCredentials> {
  const provider = config.provider.toLowerCase();
  const accessTokenRefreshBufferSeconds =
    config.accessTokenRefreshBufferSeconds ??
    DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_SECONDS;
  const refreshTokenLifetimeSeconds =
    config.refreshTokenLifetimeSeconds ?? DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS;
  const refreshLockTtlMs = config.refreshLockTtlMs ?? DEFAULT_REFRESH_LOCK_TTL_MS;
  const refreshLockPollAttempts =
    config.refreshLockPollAttempts ?? DEFAULT_REFRESH_LOCK_POLL_ATTEMPTS;
  const refreshLockPollDelayMs =
    config.refreshLockPollDelayMs ?? DEFAULT_REFRESH_LOCK_POLL_DELAY_MS;

  if (
    !isAccessTokenNearExpiry(
      credentials,
      undefined,
      accessTokenRefreshBufferSeconds,
    )
  ) {
    return credentials;
  }

  if (
    isRefreshTokenExpired(
      credentials,
      undefined,
      undefined,
      refreshTokenLifetimeSeconds,
    )
  ) {
    throw new BrokerAuthError({
      code: getReconnectRequiredCode(),
      provider,
      recoverable: false,
      message: `Reconnect required: ${provider} refresh token has expired.`,
    });
  }

  const redis = getRedisCache();
  const key = lockKey(provider, userId, credentialId);
  const value = randomUUID();
  const acquired = await redis.set(key, value, "PX", refreshLockTtlMs, "NX");

  if (acquired === "OK") {
    try {
      const latest = await getFreshCredentials(userId, credentialId, config);
      if (
        !isAccessTokenNearExpiry(
          latest.credentials,
          undefined,
          accessTokenRefreshBufferSeconds,
        )
      ) {
        return latest.credentials;
      }

      if (
        isRefreshTokenExpired(
          latest.credentials,
          { created_at: latest.createdAt },
          undefined,
          refreshTokenLifetimeSeconds,
        )
      ) {
        throw new BrokerAuthError({
          code: getReconnectRequiredCode(),
          provider,
          recoverable: false,
          message: `Reconnect required: ${provider} refresh token has expired.`,
        });
      }

      try {
        return await refreshProviderToken(userId, credentialId, latest.credentials, config);
      } catch (error) {
        if (isOAuthReconnectError(error)) {
          throw new BrokerAuthError({
            code: getReconnectRequiredCode(),
            provider,
            recoverable: false,
            message: `Reconnect required: ${provider} refresh token is no longer valid.`,
            cause: error,
          });
        }

        throw new BrokerAuthError({
          code: "OAUTH_REFRESH_FAILED",
          provider,
          recoverable: true,
          message: `Token refresh failed for ${provider}. Please retry or reconnect if the issue persists.`,
          cause: error,
        });
      }
    } finally {
      await releaseLock(key, value);
    }
  }

  for (let attempt = 0; attempt < refreshLockPollAttempts; attempt += 1) {
    await delay(refreshLockPollDelayMs);
    const latest = await getFreshCredentials(userId, credentialId, config);
    if (
      !isAccessTokenNearExpiry(
        latest.credentials,
        undefined,
        accessTokenRefreshBufferSeconds,
      )
    ) {
      return latest.credentials;
    }

    if (
      isRefreshTokenExpired(
        latest.credentials,
        { created_at: latest.createdAt },
        undefined,
        refreshTokenLifetimeSeconds,
      )
    ) {
      throw new BrokerAuthError({
        code: getReconnectRequiredCode(),
        provider,
        recoverable: false,
        message: `Reconnect required: ${provider} refresh token has expired.`,
      });
    }
  }

  throw new BrokerAuthError({
    code: "OAUTH_REFRESH_FAILED",
    provider,
    recoverable: true,
    message: `Token refresh already in progress for ${provider}; please retry shortly.`,
  });
}
