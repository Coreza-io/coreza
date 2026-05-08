import { getBrokerStreamConfig } from "../config/brokerStreamConfig";

export function normalizeOrderSymbol(symbol: string, source: string): string {
  const upper = String(symbol || "").toUpperCase();
  const normalize = getBrokerStreamConfig(source).normalizeOrderSymbol;
  return normalize ? normalize(upper) : upper;
}
