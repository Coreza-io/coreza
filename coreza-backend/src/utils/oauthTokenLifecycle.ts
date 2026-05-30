/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export const DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60;
export const DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_RECONNECT_RECOMMENDED_SECONDS = 24 * 60 * 60;

export interface CredentialTimestamps {
  created_at?: string;
}

export interface OAuthTokenLike {
  token_expires_at?: unknown;
  refresh_token_created_at?: unknown;
  refresh_token_expires_at?: unknown;
}

export interface OAuthCredentialStatus {
  reconnect_required: boolean;
  reconnect_recommended: boolean;
  refresh_token_expires_at?: number;
  seconds_until_reconnect?: number;
  access_token_expires_at?: number;
  seconds_until_access_token_expiry?: number;
  access_token_auto_managed: true;
  refresh_token_lifetime_known: boolean;
}

export interface OAuthTokenLifecycleConfig {
  accessTokenRefreshBufferSeconds?: number;
  refreshTokenLifetimeSeconds?: number;
  reconnectRecommendedSeconds?: number;
}

export function unixNowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function toUnixSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.floor(numeric);
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return undefined;
}

export function isAccessTokenNearExpiry(
  credentials: OAuthTokenLike,
  now = unixNowSeconds(),
  bufferSeconds = DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_SECONDS,
): boolean {
  const expiresAt = toUnixSeconds(credentials.token_expires_at) ?? 0;
  return now >= expiresAt - bufferSeconds;
}

export function getRefreshTokenExpiresAt(
  credentials: OAuthTokenLike,
  record?: CredentialTimestamps,
  refreshTokenLifetimeSeconds = DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS,
): { expiresAt?: number; lifetimeKnown: boolean } {
  const explicitExpiresAt = toUnixSeconds(credentials.refresh_token_expires_at);
  if (explicitExpiresAt !== undefined) {
    return { expiresAt: explicitExpiresAt, lifetimeKnown: true };
  }

  const explicitCreatedAt = toUnixSeconds(credentials.refresh_token_created_at);
  if (explicitCreatedAt !== undefined) {
    return {
      expiresAt: explicitCreatedAt + refreshTokenLifetimeSeconds,
      lifetimeKnown: true,
    };
  }

  const recordCreatedAt = toUnixSeconds(record?.created_at);
  if (recordCreatedAt !== undefined) {
    return {
      expiresAt: recordCreatedAt + refreshTokenLifetimeSeconds,
      lifetimeKnown: false,
    };
  }

  return { lifetimeKnown: false };
}

export function isRefreshTokenExpired(
  credentials: OAuthTokenLike,
  recordOrNow: CredentialTimestamps | number = unixNowSeconds(),
  maybeNow?: number,
  refreshTokenLifetimeSeconds = DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS,
): boolean {
  const record = typeof recordOrNow === "number" ? undefined : recordOrNow;
  const now = typeof recordOrNow === "number"
    ? recordOrNow
    : (maybeNow ?? unixNowSeconds());
  const { expiresAt } = getRefreshTokenExpiresAt(
    credentials,
    record,
    refreshTokenLifetimeSeconds,
  );
  return expiresAt !== undefined && now >= expiresAt;
}

export function deriveOAuthCredentialStatus(
  credentials: OAuthTokenLike,
  record?: CredentialTimestamps,
  config: OAuthTokenLifecycleConfig = {},
  now = unixNowSeconds(),
): OAuthCredentialStatus {
  const refreshTokenLifetimeSeconds =
    config.refreshTokenLifetimeSeconds ?? DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS;
  const reconnectRecommendedSeconds =
    config.reconnectRecommendedSeconds ?? DEFAULT_RECONNECT_RECOMMENDED_SECONDS;
  const accessTokenExpiresAt = toUnixSeconds(credentials.token_expires_at);
  const { expiresAt, lifetimeKnown } = getRefreshTokenExpiresAt(
    credentials,
    record,
    refreshTokenLifetimeSeconds,
  );
  const secondsUntilReconnect =
    expiresAt === undefined ? undefined : expiresAt - now;
  const secondsUntilAccessTokenExpiry =
    accessTokenExpiresAt === undefined ? undefined : accessTokenExpiresAt - now;
  const reconnectRequired = secondsUntilReconnect !== undefined
    ? secondsUntilReconnect <= 0
    : false;

  return {
    reconnect_required: reconnectRequired,
    reconnect_recommended:
      !reconnectRequired &&
      (!lifetimeKnown ||
        secondsUntilReconnect === undefined ||
        secondsUntilReconnect < reconnectRecommendedSeconds),
    refresh_token_expires_at: expiresAt,
    seconds_until_reconnect: secondsUntilReconnect,
    access_token_expires_at: accessTokenExpiresAt,
    seconds_until_access_token_expiry: secondsUntilAccessTokenExpiry,
    access_token_auto_managed: true,
    refresh_token_lifetime_known: lifetimeKnown,
  };
}
