/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
  exchange?: string;
  crypto_base?: string;
  crypto_quote?: string;
  stream_type: string;
  credential_id?: string;
  environment?: "testnet" | "live" | "paper";
  marketType?: "spot" | "futures";
  contractType?: "perpetual" | "current_quarter" | "next_quarter";
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
  streamType: string[];
  exchange?: string;
  source: string;
  mode: "listen" | "subscribe";
  scope: "workflow" | "global";
  message?: string;
  error?: string;
}
