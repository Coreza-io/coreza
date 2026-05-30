/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export type BrokerAuthErrorCode =
  | "OAUTH_RECONNECT_REQUIRED"
  | "OAUTH_REFRESH_FAILED";

export class BrokerAuthError extends Error {
  readonly code: BrokerAuthErrorCode;
  readonly provider: string;
  readonly recoverable: boolean;

  constructor(params: {
    code: BrokerAuthErrorCode;
    provider: string;
    message: string;
    recoverable: boolean;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "BrokerAuthError";
    this.code = params.code;
    this.provider = params.provider;
    this.recoverable = params.recoverable;

    if (params.cause !== undefined) {
      this.cause = params.cause;
    }
  }

  toJSON() {
    return {
      code: this.code,
      provider: this.provider,
      recoverable: this.recoverable,
      error: this.message,
    };
  }
}

export function isBrokerAuthError(error: unknown): error is BrokerAuthError {
  return error instanceof BrokerAuthError;
}

export function getReconnectRequiredCode(): BrokerAuthErrorCode {
  return "OAUTH_RECONNECT_REQUIRED";
}

export function isOAuthReconnectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeAxios = error as {
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const status = maybeAxios.response?.status;
  const responseData = maybeAxios.response?.data;
  const searchable = [
    maybeAxios.message,
    typeof responseData === "string" ? responseData : undefined,
    typeof responseData === "object" && responseData !== null
      ? JSON.stringify(responseData)
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return (
    status === 401 ||
    searchable.includes("invalid_grant") ||
    searchable.includes("unauthorized") ||
    searchable.includes("refresh token")
  );
}
