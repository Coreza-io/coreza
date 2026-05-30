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
      Object.defineProperty(this, "cause", { value: params.cause });
    }
  }
}

export function getReconnectRequiredCode(): BrokerAuthErrorCode {
  return "OAUTH_RECONNECT_REQUIRED";
}

export function isOAuthReconnectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as {
    status?: number;
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const status = value.status ?? value.response?.status;
  const responseData = value.response?.data;
  const searchable = [
    value.message,
    typeof responseData === "string" ? responseData : undefined,
    typeof responseData === "object" && responseData !== null
      ? JSON.stringify(responseData)
      : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" ")
    .toLowerCase();

  return (
    status === 401 ||
    searchable.includes("invalid_grant") ||
    searchable.includes("unauthorized") ||
    searchable.includes("refresh token")
  );
}
