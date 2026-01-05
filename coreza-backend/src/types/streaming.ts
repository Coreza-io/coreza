/*
 * Copyright (C) 2024 Coreza
 * Stream Execution Contract - Backend-owned types for unified streaming endpoint
 */

/**
 * Request payload for the unified /market/execute-stream-node endpoint.
 * This is the only contract the frontend needs to know.
 */
export interface StreamExecutionRequest {
  workflow_id: string;
  node_id: string;
  node_type: string; // "BinanceStreamData", "AlpacaStreamData", etc.
  category: string;
  subCategory: string;
  mode: "listen" | "subscribe"; // User-selected mode

  // For subscribe mode
  symbols?: string[];
  stream_types?: string[];
  credential_id?: string;
  environment?: "testnet" | "live";
  asset_type?: "spot" | "futures";
  feed?: "iex" | "sip";
  kline_interval?: string;

  // For filtering (both modes)
  filter_symbols?: string[];
  filter_types?: string[];
  subscriptionMode?: "workflow" | "global";
}

/**
 * Response from the unified /market/execute-stream-node endpoint.
 */
export interface StreamExecutionResponse {
  success: boolean;
  status: "listening" | "error";
  symbols: string[];
  testKey: string;
  message?: string;
  error?: string;
}

// /**
//  * Maps node types to their streaming source identifiers.
//  * Backend owns this mapping - frontend never derives sources.
//  */
// export const NODE_TYPE_TO_SOURCE: Record<string, string> = {
//   BinanceStreamData: "binance_stream",
//   BinanceSubscribe: "binance_stream",
//   AlpacaStreamData: "alpaca",
//   AlpacaSubscribe: "alpaca",
//   DhanStreamData: "dhan_stream",
//   DhanSubscribe: "dhan_stream",
// };

// /**
//  * Resolve streaming source from node type.
//  */
// export function resolveSourceFromNodeType(nodeType: string): string {
//   return NODE_TYPE_TO_SOURCE[nodeType] || "unknown";
// }
