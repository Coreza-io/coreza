/*
 * Copyright (C) 2024 Coreza
 * Stream Execution Contract - Backend-owned types for unified streaming endpoint
 */

/**
 * Request payload for the unified /market/execute-stream-node endpoint.
 * This is the only contract the frontend needs to know.
 */
export interface StreamExecutionRequest {
  workflowId: string;
  node_id: string;
  node_type: string; // "BinanceStreamData", "AlpacaStreamData", etc.
  category: string;
  subCategory: string;
  mode: "listen" | "subscribe"; // User-selected mode

  // For subscribe mode
  symbols?: string[] | string;
  assetType?: "stock" | "crypto" | "news";
  crypto_base?: string;
  crypto_quote?: string;
  stream_type: string;
  credential_id?: string;
  environment?: "testnet" | "live" | "paper";
  marketType?: "spot" | "futures";
  feed?: "iex" | "sip" | "test";
  interval?: string;
  depth_levels?: string;
  scope: "workflow" | "global";
  onlyClosedBars: boolean;
}

/**
 * Response from the unified /market/execute-stream-node endpoint.
 */
export interface StreamExecutionResponse {
  success: boolean;
  status: "listening" | "error";
  symbols: string[];
  message?: string;
  error?: string;
}
