import { BROKER_CAPABILITIES } from "./capabilities";

/** Resolve symbols through the broker's capability, retaining the caller's default policy. */
export function resolveSymbols<T>(
  brokerOrSource: string,
  assetType: unknown,
  input: unknown,
  fallback: () => T,
): string[] | T {
  const broker = brokerOrSource.split("_")[0];
  return BROKER_CAPABILITIES[broker]?.resolveSymbols?.(assetType, input) ?? fallback();
}
