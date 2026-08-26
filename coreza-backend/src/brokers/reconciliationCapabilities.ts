export type ReconcileSupport = "client_id" | "algo_client_id" | "position_based" | "none";

export interface ReconciliationCapability {
  support: ReconcileSupport;
  liveScanAllowed: boolean;
}

const NONE: ReconciliationCapability = { support: "none", liveScanAllowed: false };

export function getReconciliationCapability(
  broker: string,
  operation: string,
  orderKind: "standard" | "algo" = "standard",
): ReconciliationCapability {
  if (operation === "close_position") return { support: "position_based", liveScanAllowed: false };
  if (operation !== "place_order") return NONE;
  if (broker === "alpaca") return { support: "client_id", liveScanAllowed: true };
  if (broker === "binance" && orderKind === "algo") {
    return { support: "algo_client_id", liveScanAllowed: false };
  }
  if (broker === "binance") return { support: "client_id", liveScanAllowed: true };
  return NONE;
}

export function resolveOrderKind(
  broker: string,
  params: Record<string, unknown>,
): "standard" | "algo" {
  const type = String(params.type ?? params.orderType ?? "").toUpperCase();
  const marketType = String(params.marketType ?? params.asset_type ?? params.assetType ?? "spot").toLowerCase();
  return broker === "binance" && marketType === "futures" &&
    ["STOP", "TAKE_PROFIT", "STOP_MARKET", "TAKE_PROFIT_MARKET", "TRAILING_STOP_MARKET"].includes(type)
    ? "algo"
    : "standard";
}
