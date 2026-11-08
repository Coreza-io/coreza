import { createError } from "../../middleware/errorHandler";

/** Validate a full Alpaca crypto pair after expression resolution. */
export function validateAlpacaCryptoSymbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]+\/[A-Z0-9]+$/i.test(value.trim())) {
    throw new Error("Invalid Alpaca crypto symbol. Enter a full pair such as ETH/USD.");
  }
  return value.trim().toUpperCase();
}

/** Resolve full Alpaca crypto pairs directly, without base/quote construction. */
export function resolveAlpacaSymbols(assetType: unknown, input: unknown): string[] | undefined {
  if (assetType !== "crypto") return undefined;
  if (input == null || (typeof input === "string" && input.trim() === "")) return [];
  const symbols = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [input];
  try {
    return symbols.map(validateAlpacaCryptoSymbol);
  } catch (error) {
    throw createError(error instanceof Error ? error.message : "Invalid Alpaca crypto symbols", 400);
  }
}
