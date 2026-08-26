export type ReconcileSupport = "client_id" | "algo_client_id" | "position_based" | "none";

export interface ReconciliationCapability {
  support: ReconcileSupport;
  liveScanAllowed: boolean;
}

const NONE: ReconciliationCapability = { support: "none", liveScanAllowed: false };

export const RECONCILIATION_CAPABILITIES: Readonly<Record<string, ReconciliationCapability>> = Object.freeze({
  "alpaca:place_order": { support: "client_id", liveScanAllowed: true },
  "binance:place_order": { support: "client_id", liveScanAllowed: true },
  "binance:place_order:algo": { support: "algo_client_id", liveScanAllowed: false },
});

export function getReconciliationCapability(
  broker: string,
  operation: string,
  orderKind: "standard" | "algo" = "standard",
): ReconciliationCapability {
  if (operation === "close_position") return { support: "position_based", liveScanAllowed: false };
  const baseKey = `${broker}:${operation}`;
  return RECONCILIATION_CAPABILITIES[orderKind === "algo" ? `${baseKey}:algo` : baseKey] ?? NONE;
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
