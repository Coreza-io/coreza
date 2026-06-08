/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import {
  isTradingSource,
  getTradingRoutingKey,
  parseStreamNameBySource,
  buildStreamNameBySource,
  BROKER_CAPABILITIES,
} from "../brokers/capabilities";

export interface StreamIdentifier {
  symbol: string;
  eventType: string;
  interval?: string;
  contractType?: string;
  exchange?: string;
}

export const NATIVE_TRADING_STREAM_NAMES = new Set([
  "trade_updates",
  "ORDER_TRADE_UPDATE",
  "ALGO_UPDATE",
  "ACCOUNT_UPDATE",
  "ACCOUNT_CONFIG_UPDATE",
  "MARGIN_CALL",
  "listenKeyExpired",
  "executionReport",
  "outboundAccountPosition",
  "balanceUpdate",
  "order_update", // backwards-compatible alias during rollout
]);

export function tradingRoutingKey(source: string, eventType: string): string {
  return getTradingRoutingKey(source, eventType);
}

/**
 * Build native stream name for broker subscription (config-driven)
 */
function buildStreamKey(
  source: string,
  symbol: string,
  eventType: string,
  interval?: string,
  contractType?: string,
  exchange?: string,
): string {
  // Trading sources route through their routing key
  if (isTradingSource(source)) {
    return getTradingRoutingKey(source, eventType);
  }

  return buildStreamNameBySource(
    source,
    symbol,
    eventType,
    interval,
    contractType,
    exchange,
  );
}

export function buildStreamName(
  source: string,
  symbol: string,
  eventType: string,
  interval?: string,
  contractType?: string,
  exchange?: string,
): string {
  return buildStreamKey(
    source,
    symbol,
    eventType,
    interval,
    contractType,
    exchange,
  );
}

export function parseStreamName(
  source: string,
  streamName: string,
): StreamIdentifier {
  if (NATIVE_TRADING_STREAM_NAMES.has(streamName)) {
    return { symbol: "*", eventType: streamName };
  }

  return parseStreamNameBySource(source, streamName);
}

export function buildStreamNames(
  source: string,
  symbols: string[],
  eventTypes: string[],
  interval?: string,
  contractType?: string,
  exchange?: string,
): string[] {
  const streamNames: string[] = [];
  const brokerKey = source.split("_")[0];
  const cap = BROKER_CAPABILITIES[brokerKey];
  const normalizeEventType = cap?.streamParser.normalizeEventType;

  for (const symbol of symbols) {
    for (const rawEventType of eventTypes) {
      const eventType = normalizeEventType
        ? normalizeEventType(rawEventType)
        : rawEventType;

      // Check if event type contains an embedded interval (e.g., "kline_1m")
      const underscoreIndex = eventType.indexOf("_");
      if (
        underscoreIndex !== -1 &&
        normalizeEventType &&
        eventType !== "continuous_kline"
      ) {
        const type = eventType.slice(0, underscoreIndex);
        const embeddedInterval = eventType.slice(underscoreIndex + 1);
        streamNames.push(
          buildStreamName(
            source,
            symbol,
            type,
            embeddedInterval,
            contractType,
            exchange,
          ),
        );
      } else if (eventType.startsWith("depth") && normalizeEventType) {
        const depthInterval = eventType.slice(5);
        streamNames.push(
          buildStreamName(
            source,
            symbol,
            "depth",
            depthInterval || "20",
            contractType,
            exchange,
          ),
        );
      } else {
        streamNames.push(
          buildStreamName(
            source,
            symbol,
            eventType,
            interval,
            contractType,
            exchange,
          ),
        );
      }
    }
  }

  return streamNames;
}

export function extractSymbol(source: string, streamName: string): string {
  return parseStreamName(source, streamName).symbol;
}
