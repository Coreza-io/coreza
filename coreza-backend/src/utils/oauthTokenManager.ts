/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { randomUUID } from "crypto";
import { getRedisCache } from "../config/redis";
import OAuthService from "../services/oauthService";
import CredentialManager from "./credentialManager";
import {
  BrokerAuthError,
  getReconnectRequiredCode,
  isOAuthReconnectError,
} from "./brokerAuthError";
import {
  isAccessTokenNearExpiry,
  isRefreshTokenExpired,
} from "./oauthTokenLifecycle";

const REFRESH_LOCK_TTL_MS = 10_000;
const REFRESH_LOCK_POLL_ATTEMPTS = 5;
const REFRESH_LOCK_POLL_DELAY_MS = 250;

function refreshLockKey(
  provider: string,
  userId: string,
  credentialId: string,
): string {
  const safeUserId = encodeURIComponent(userId);
  const safeCredentialId = encodeURIComponent(credentialId);
  return `${provider.toLowerCase()}:token-refresh:${safeUserId}:${safeCredentialId}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FreshCredentials {
  credentials: Record<string, unknown>;
  createdAt?: string;
}

async function getFreshCredentials(
  provider: string,
  userId: string,
  credentialId: string,
): Promise<FreshCredentials> {
  const result = await CredentialManager.getCredentials(
    userId,
    provider,
    credentialId,
    { useCache: false },
  );

  if (!result.credentials) {
    throw new Error(`Credentials not found for ${provider}`);
  }

  return {
    credentials: {
      ...result.credentials.client_json,
      ...result.credentials.token_json,
    },
    createdAt: result.created_at,
  };
}

async function releaseRefreshLock(
  lockKey: string,
  lockValue: string,
): Promise<void> {
  const redis = getRedisCache();
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    lockKey,
    lockValue,
  );
}

/**
 * Generic OAuth token refresh utility.
 * Refreshes tokens inside a Redis lock to avoid provider refresh stampedes.
 */
export async function refreshOAuthTokenIfNeeded(
  provider: string,
  credentials: Record<string, unknown>,
  userId: string,
  credentialId: string,
): Promise<Record<string, unknown>> {
  const normalizedProvider = provider.toLowerCase();
  const lifecycleConfig = OAuthService.getTokenLifecycleConfig(normalizedProvider);
  const accessTokenRefreshBufferSeconds =
    lifecycleConfig?.accessTokenRefreshBufferSeconds;
  const refreshTokenLifetimeSeconds = lifecycleConfig?.refreshTokenLifetimeSeconds;

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
      provider: normalizedProvider,
      recoverable: false,
      message: `Reconnect required: ${normalizedProvider} refresh token has expired.`,
    });
  }

  const redis = getRedisCache();
  const lockKey = refreshLockKey(normalizedProvider, userId, credentialId);
  const lockValue = randomUUID();
  const lockAcquired = await redis.set(
    lockKey,
    lockValue,
    "PX",
    REFRESH_LOCK_TTL_MS,
    "NX",
  );

  if (lockAcquired === "OK") {
    try {
      const latestCredentials = await getFreshCredentials(
        normalizedProvider,
        userId,
        credentialId,
      );

      if (
        !isAccessTokenNearExpiry(
          latestCredentials.credentials,
          undefined,
          accessTokenRefreshBufferSeconds,
        )
      ) {
        return latestCredentials.credentials;
      }

      if (
        isRefreshTokenExpired(
          latestCredentials.credentials,
          { created_at: latestCredentials.createdAt },
          undefined,
          refreshTokenLifetimeSeconds,
        )
      ) {
        throw new BrokerAuthError({
          code: getReconnectRequiredCode(),
          provider: normalizedProvider,
          recoverable: false,
          message: `Reconnect required: ${normalizedProvider} refresh token has expired.`,
        });
      }

      console.log(
        `🔄 [${normalizedProvider.toUpperCase()}] Access token near expiry, refreshing...`,
      );

      try {
        const { tokens } = await OAuthService.refreshToken(
          normalizedProvider,
          userId,
          credentialId,
        );

        console.log(
          `✅ [${normalizedProvider.toUpperCase()}] Token refreshed successfully`,
        );

        return {
          ...latestCredentials.credentials,
          ...tokens,
        };
      } catch (error) {
        if (isOAuthReconnectError(error)) {
          throw new BrokerAuthError({
            code: getReconnectRequiredCode(),
            provider: normalizedProvider,
            recoverable: false,
            message: `Reconnect required: ${normalizedProvider} refresh token is no longer valid.`,
            cause: error,
          });
        }

        throw new BrokerAuthError({
          code: "OAUTH_REFRESH_FAILED",
          provider: normalizedProvider,
          recoverable: true,
          message: `Token refresh failed for ${normalizedProvider}. Please retry or reconnect if the issue persists.`,
          cause: error,
        });
      }
    } finally {
      await releaseRefreshLock(lockKey, lockValue);
    }
  }

  for (let attempt = 0; attempt < REFRESH_LOCK_POLL_ATTEMPTS; attempt += 1) {
    await delay(REFRESH_LOCK_POLL_DELAY_MS);
    const latestCredentials = await getFreshCredentials(
      normalizedProvider,
      userId,
      credentialId,
    );

    if (
      !isAccessTokenNearExpiry(
        latestCredentials.credentials,
        undefined,
        accessTokenRefreshBufferSeconds,
      )
    ) {
      return latestCredentials.credentials;
    }

    if (
      isRefreshTokenExpired(
        latestCredentials.credentials,
        { created_at: latestCredentials.createdAt },
        undefined,
        refreshTokenLifetimeSeconds,
      )
    ) {
      throw new BrokerAuthError({
        code: getReconnectRequiredCode(),
        provider: normalizedProvider,
        recoverable: false,
        message: `Reconnect required: ${normalizedProvider} refresh token has expired.`,
      });
    }
  }

  throw new BrokerAuthError({
    code: "OAUTH_REFRESH_FAILED",
    provider: normalizedProvider,
    recoverable: true,
    message: `Token refresh already in progress for ${normalizedProvider}; please retry shortly.`,
  });
}
