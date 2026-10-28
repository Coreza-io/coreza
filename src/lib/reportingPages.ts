/** Each caller supplies deterministic ordering, including an id tie-breaker. */
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
