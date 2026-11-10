import type { NodeResult } from '../types';

/** Only explicit, safe evidence crosses the model boundary; never flatten provider bodies. */
export function toolFailure(result: NodeResult, providerRequestSent: boolean) {
  const details = result.details;
  const httpStatus = details?.status;
  const code = details?.code;
  const safeCode = typeof code === 'string' && /^[A-Z_0-9]{1,64}$/.test(code) ? code : undefined;
  const status = code === 'RESOURCE_LIMIT' ? 'resource_limit'
    : code === 'INVALID_OUTPUT' ? 'invalid_output'
    : code === 'ORDER_STATUS_UNKNOWN' ? 'reconciliation_required'
    : httpStatus === 401 ? 'authentication_failed'
    : httpStatus === 403 ? 'permission_denied'
    : httpStatus === 429 ? 'rate_limited'
    : httpStatus === 400 || httpStatus === 422 ? 'provider_invalid_input'
    : code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'timeout'
    : httpStatus && httpStatus >= 500 ? 'upstream_error' : result.status;
  const messages: Record<string, string> = {
    resource_limit: 'The response exceeds the run memory budget. Request a smaller explicit range or fewer pages.',
    invalid_output: 'Provider returned malformed market data.',
    reconciliation_required: 'Order status is unknown. Reconcile with the exchange before submitting again.',
    authentication_failed: 'The configured credentials were rejected.',
    permission_denied: 'The provider denied this request. Preserve the configured account and requested feed.',
    rate_limited: 'The provider rate limit was reached.',
    provider_invalid_input: 'The provider rejected the request parameters.',
    timeout: 'The provider request timed out.', upstream_error: 'The provider request failed.',
  };
  const providerCode = details?.response?.providerCode;
  return { success: false, status, type: 'tool_error', retryable_by_agent: false,
    provider_request_sent: providerRequestSent,
    error: { message: messages[status] ?? `Tool execution did not complete (${result.status}).`,
      code: safeCode, httpStatus,
      providerCode: typeof providerCode === 'number' ? providerCode : undefined,
      recoverable: details?.recoverable } };
}
