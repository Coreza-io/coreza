export function normalizeOrderSymbol(symbol: string, source: string): string {
  const upper = String(symbol || "").toUpperCase();

  if (source === "alpaca") {
    return upper.replace("/", "");
  }

  return upper;
}
