import { createHash } from "crypto";

/** Stable UUID derived from the finalized trade's own identity, including partial exits. */
export function reportingTradeId(scope: string, tradeId: string): string {
  const h = createHash("sha256").update(`${scope}:${tradeId}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export const finiteMetrics = (metrics: object): Record<string, number | null> =>
  Object.fromEntries(Object.entries(metrics).map(([key, value]) =>
    [key, typeof value === "number" && Number.isFinite(value) ? value : null]));

/** Read full history, with a stable tie-breaker and no implicit API row-limit truncation. */
export async function reportingPages<T = any>(query: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ;) {
    const { data, error } = await query().range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data?.length) return rows;
    offset += data.length;
  }
}
