function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function extractDhanOrderOwnerIds(data: unknown) {
  const record = toRecord(data);
  if (!record) {
    return {};
  }

  const orderId = record.orderId ?? record.OrderNo ?? record.order_id;
  const clientOrderId = record.correlationId ?? record.CorrelationId;
  const exchangeOrderId = record.exchangeOrderId ?? record.ExchangeOrderId;

  return {
    orderId: orderId != null ? String(orderId) : undefined,
    clientOrderId: clientOrderId != null ? String(clientOrderId) : undefined,
    exchangeOrderId:
      exchangeOrderId != null ? String(exchangeOrderId) : undefined,
  };
}
