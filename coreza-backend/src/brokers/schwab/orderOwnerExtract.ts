export function extractSchwabOrderOwnerIds(data: any): Record<string, string | undefined> {
  const orderId = data?.orderId ?? data?.order_id ?? data?.id;

  return {
    orderId: orderId !== undefined && orderId !== null ? String(orderId) : undefined,
  };
}
