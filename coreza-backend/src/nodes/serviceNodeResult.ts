import { resultFailure, resultSuccess, safeErrorDetails, type NodeResult, type ResultMeta } from "../contracts/nodeResult";

/** Translate the service layer's current operation response at its executor/HTTP boundary. */
export function serviceNodeResult(response: { success: boolean; data?: unknown; error?: string; code?: string; provider?: string; recoverable?: boolean; meta?: ResultMeta }): NodeResult {
  const options = { meta: response.meta, details: safeErrorDetails({ code: response.code, provider: response.provider, recoverable: response.recoverable }) };
  return response.success ? resultSuccess(response.data, options)
    : resultFailure(response.error ?? "Service operation failed", { ...options, data: response.data });
}
