import { resolveAlpacaStreamSymbols } from "../brokers/alpaca/cryptoOrderSymbol";

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

/** Delegate broker-specific symbol rules before applying the caller's standard policy. */
export function resolveStreamSymbols<T>(
  source: string,
  assetType: unknown,
  cryptoInput: unknown,
  fallback: () => T,
): string[] | T {
  const brokerSymbols = source.split("_")[0] === "alpaca"
    ? resolveAlpacaStreamSymbols(assetType, cryptoInput)
    : undefined;
  return brokerSymbols ?? fallback();
}
