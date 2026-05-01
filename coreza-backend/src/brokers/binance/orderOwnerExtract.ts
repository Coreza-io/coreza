export function extractBinanceOrderOwnerIds(data: any) {
  return {
    clientOrderId: String(data?.clientOrderId || "").trim() || undefined,
    orderId: String(data?.orderId ?? data?.order_id ?? "").trim() || undefined,
    clientAlgoId: String(data?.clientAlgoId || "").trim() || undefined,
    algoId: String(data?.algoId ?? "").trim() || undefined,
  };
}
