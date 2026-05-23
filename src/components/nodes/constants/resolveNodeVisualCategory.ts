/**
 * Maps a node definition to its visual category. Exact name mapping
 * runs first, then a broad category fallback per the design guide.
 */

import type { NodeVisualCategory } from "./nodeVisualThemes";

const compact = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const includesAny = (value: string, keys: string[]) =>
  !!value && keys.some((key) => value.includes(compact(key)));

export function resolveNodeVisualCategory(
  definition: any,
): NodeVisualCategory {
  const name = compact(
    definition?.name || definition?.def || definition?.displayName,
  );
  const category = compact(definition?.category);

  // Exact node mapping first
  if (
    includesAny(name, [
      "AlpacaStreamListener",
      "Buy",
      "Sell",
      "PlaceOrder",
      "getBrokerBalance",
      "getBrokerPosition",
      "Alpaca",
    ])
  )
    return "action";

  if (
    includesAny(name, [
      "getPortfolio",
      "createPortfolio",
      "updatePortfolioValue",
      "getPosition",
      "getOpenOrders",
      "RegisterBuyOrder",
      "RegisterSellOrder",
      "AssetRegistry",
    ])
  )
    return "utility";

  if (
    includesAny(name, [
      "RSI",
      "EMA",
      "SMA",
      "MACD",
      "BollingerBands",
      "VolumeOscillator",
      "ATR",
      "ADX",
    ])
  )
    return "indicator";

  if (
    includesAny(name, [
      "underValued",
      "ifUndervalued",
      "noPosition",
      "noOpenOrder",
      "isLongPosition",
      "portfolioNotExist",
      "switch",
      "if",
    ])
  )
    return "logic";

  if (includesAny(name, ["Visualize", "Performance"])) return "output";

  // Broad category fallback
  if (
    includesAny(category, ["logic", "switch", "if", "condition", "compute"])
  )
    return "logic";
  if (
    includesAny(category, [
      "indicator",
      "indicators",
      "data",
      "stream",
      "input",
    ])
  )
    return "indicator";
  if (
    includesAny(category, [
      "portfolio",
      "broker",
      "utility",
      "register",
      "screener",
    ])
  )
    return "utility";
  if (
    includesAny(category, [
      "ai",
      "action",
      "llm",
      "chatmodel",
      "trigger",
      "scheduler",
      "backtest",
      "webhook",
    ])
  )
    return "action";
  if (
    includesAny(category, [
      "visualize",
      "visualization",
      "output",
      "performance",
      "risk",
      "destructive",
    ])
  )
    return "output";

  return "utility";
}
