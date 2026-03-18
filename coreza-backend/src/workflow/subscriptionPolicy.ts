import { MarketSource } from "../brokers";
import { WorkflowNode } from "../nodes/types";

export const nodeNameToSourceMap: Record<string, MarketSource | `${MarketSource}_${string}`> = {
  BinanceStreamData: "binance_stream",
  AlpacaStreamData: "alpaca_stream",
  AlpacaNews: "alpaca_news",
  DhanStreamData: "dhan_stream",
};

export function resolveStreamSourceId(
  node: WorkflowNode,
): MarketSource | `${MarketSource}_${string}` | null {
  const workflowNode = node as WorkflowNode & {
    subCategory?: string;
    values?: { data_type?: string };
    data?: { values?: { data_type?: string } };
  };

  const baseSource = workflowNode.subCategory || nodeNameToSourceMap[workflowNode.name ?? ""];
  if (!baseSource) {
    return null;
  }

  const dataType =
    workflowNode.values?.data_type ?? workflowNode.data?.values?.data_type;

  return dataType ? `${baseSource}_${dataType}` : baseSource;
}

export function parseSymbols(symbols: unknown): string[] {
  if (typeof symbols === "string") {
    return symbols
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);
  }

  if (Array.isArray(symbols)) {
    return symbols.filter((symbol): symbol is string => typeof symbol === "string");
  }

  return [];
}
