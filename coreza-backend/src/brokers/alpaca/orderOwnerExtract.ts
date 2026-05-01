export function extractAlpacaOrderOwnerIds(data: any) {
  return {
    clientOrderId: String(data?.client_order_id || "").trim() || undefined,
    orderId: String(data?.id || "").trim() || undefined,
  };
}
