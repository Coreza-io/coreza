import { validateAlpacaCryptoSymbol } from "../brokers/alpaca/cryptoOrderSymbol";
import { createError } from "../middleware/errorHandler";

/**
 * Shared symbol resolution helpers.
 * Used by both stream routes (manual test) and StreamingLifecycleAdapter (live activation).
 */

/**
 * Build crypto symbols from crypto_base + crypto_quote fields.
 * Returns empty array if data_type is not 'crypto' or crypto_base is missing.
 */
export function buildCryptoSymbols(
  assetType: unknown,
  cryptoBase: unknown,
  cryptoQuote: unknown,
): string[] {
  if (assetType !== "crypto" || !cryptoBase) {
    return [];
  }

  const quote = String(cryptoQuote || "USD")
    .trim()
    .toUpperCase();
  const bases = String(cryptoBase)
    .split(",")
    .map((b) => b.trim().toUpperCase())
    .filter(Boolean);

  return bases.map((base) => `${base}/${quote}`);
}

/**
 * Normalize a symbol input (string or array) into a clean array.
 */
export function normalizeSymbolList(symbols: unknown): string[] {
  if (Array.isArray(symbols)) {
    return symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  }

  if (typeof symbols === "string") {
    return symbols
      .split(",")
      .map((s: string) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  return [];
}

/** Alpaca streams use full pairs directly, never base/quote construction. */
export function validateAlpacaCryptoSymbols(input: unknown): string[] {
  if (input == null || (typeof input === "string" && input.trim() === "")) return [];
  const symbols = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [input];
  try {
    return symbols.map(validateAlpacaCryptoSymbol);
  } catch (error) {
    throw createError(error instanceof Error ? error.message : "Invalid Alpaca crypto symbols", 400);
  }
}
