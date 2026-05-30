export const DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60;
export const DEFAULT_REFRESH_TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export interface CredentialTimestamps {
  created_at?: string;
}

export interface OAuthTokenLike {
  token_expires_at?: unknown;
  refresh_token_created_at?: unknown;
  refresh_token_expires_at?: unknown;
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
    if (Number.isFinite(numeric)) return Math.floor(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
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
