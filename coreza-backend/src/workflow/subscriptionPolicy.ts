import { MarketSource } from "../brokers";
import { WorkflowNode } from "../nodes/types";

export const nodeNameToSourceMap: Record<
  string,
  MarketSource | `${MarketSource}_${string}`
> = {
  BinanceStreamData: "binance_stream",
  AlpacaStreamData: "alpaca_stream",
  AlpacaNews: "alpaca_news",
  DhanStreamData: "dhan_stream",
};

export function resolveStreamSourceId(
  node: WorkflowNode,
): MarketSource | `${MarketSource}_${string}` | null {
  const baseSource = node.subCategory || nodeNameToSourceMap[node.name ?? ""];

  if (!baseSource) {
    return null;
  }

  const assetType = node.values?.assetType;

  return assetType
    ? `${baseSource}_${assetType.toLowerCase()}`
    : `${baseSource}_market`;
}

export function parseSymbols(symbols: unknown): string[] {
  if (typeof symbols === "string") {
    return symbols
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);
  }

  if (Array.isArray(symbols)) {
    return symbols.filter(
      (symbol): symbol is string => typeof symbol === "string",
    );
  }

  return [];
}
