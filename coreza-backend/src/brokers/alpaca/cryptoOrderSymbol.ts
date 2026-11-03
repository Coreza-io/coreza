const KNOWN_CRYPTO_QUOTES = ["USD", "USDT", "USDC", "BTC"];

function inputText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Alpaca ${field} must be a string`);
  }
  return value.trim().toUpperCase() || undefined;
}

function explicitPair(value: string): string {
  const parts = value.split("/").map(part => part.trim());
  if (parts.length !== 2 || parts.some(part => !/^[A-Z0-9]+$/.test(part))) {
    throw new Error("Invalid Alpaca crypto pair. Expected a full pair such as ETH/USD.");
  }
  return parts.join("/");
}

function canonicalSymbol(value: string): string {
  if (value.includes("/")) return explicitPair(value);
  const quote = KNOWN_CRYPTO_QUOTES.find(
    candidate => value.endsWith(candidate) && value.length > candidate.length,
  );
  if (!quote) {
    throw new Error("Invalid Alpaca crypto symbol. Expected ETH/USD or a compact pair such as ETHUSD.");
  }
  return explicitPair(`${value.slice(0, -quote.length)}/${quote}`);
}

/** Resolve already-evaluated order inputs; a full base pair always owns its quote. */
export function resolveAlpacaCryptoOrderSymbol(
  input: { crypto_base?: unknown; crypto_quote?: unknown; symbol?: unknown },
  options: { preferSymbol?: boolean; fallbackSymbol?: string } = {},
): string | undefined {
  const base = inputText(input.crypto_base, "Base Asset");
  if (base?.includes("/")) return explicitPair(base);

  // Capabilities prefer split fields; direct HTTP callers historically prefer symbol.
  if (options.preferSymbol) {
    const symbol = inputText(input.symbol, "symbol");
    if (symbol) return canonicalSymbol(symbol);
  }
  if (base) {
    const quote = inputText(input.crypto_quote, "Quote Currency") || "USD";
    return explicitPair(`${base}/${quote}`);
  }
  const symbol = inputText(input.symbol, "symbol");
  return symbol ? canonicalSymbol(symbol) : options.fallbackSymbol;
}
