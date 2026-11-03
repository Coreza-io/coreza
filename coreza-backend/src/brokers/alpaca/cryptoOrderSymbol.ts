/** Validate a full Alpaca crypto pair after expression resolution. */
export function validateAlpacaCryptoSymbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]+\/[A-Z0-9]+$/i.test(value.trim())) {
    throw new Error("Invalid Alpaca crypto symbol. Enter a full pair such as ETH/USD.");
  }
  return value.trim().toUpperCase();
}
