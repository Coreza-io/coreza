/** https://developers.openai.com/api/docs/models/gpt-6.1-sol
 * Exact model identities only; unknown models retain their existing configuration. */
export const SOL_MODEL_ID = 'gpt-6.1-sol';
export const SOL_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const SOL_DEFAULT_EFFORT = 'medium';
export const SOL_MAX_OUTPUT_TOKENS = 128_000;
export type SolReasoningEffort = typeof SOL_REASONING_EFFORTS[number];

export function isSolModel(provider: string, model: string): boolean {
  return provider === 'openai' && model === SOL_MODEL_ID;
}

export function resolveSolEffort(value: unknown): SolReasoningEffort {
  const effort = value ?? SOL_DEFAULT_EFFORT;
  if (!SOL_REASONING_EFFORTS.includes(effort as SolReasoningEffort)) {
    throw new Error(`${SOL_MODEL_ID} reasoning effort must be low, medium, high, xhigh or max`);
  }
  return effort as SolReasoningEffort;
}
