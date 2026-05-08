import { MarketSource } from "../brokers";
import { buildNodeNameToSourceMap, resolveStreamSourceFromBroker } from "../brokers/capabilities";
import { WorkflowNode } from "../nodes/types";

// Auto-generated from broker capabilities registry (config-driven)
export const nodeNameToSourceMap: Record<
  string,
  MarketSource | `${MarketSource}_${string}`
> = buildNodeNameToSourceMap() as Record<string, MarketSource | `${MarketSource}_${string}`>;

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
