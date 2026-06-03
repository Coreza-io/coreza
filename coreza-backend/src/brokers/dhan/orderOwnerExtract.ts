export function extractDhanOrderOwnerIds(data: Record<string, unknown>) {
  const orderId = data?.orderId ?? data?.OrderNo ?? data?.order_id;
  const clientOrderId = data?.correlationId ?? data?.CorrelationId;
  return {
    orderId: orderId != null ? String(orderId) : undefined,
    clientOrderId: clientOrderId ? String(clientOrderId) : undefined,
  };
}
