/**
 * Normalize stream_types from string/array + include_order_updates checkbox
 * into a unified string array for backend consumption.
 */
export function normalizeStreamTypes(
  streamTypes: string | string[] | undefined,
  includeOrderUpdates?: boolean,
): string[] {
  let result: string[] = [];
  if (streamTypes) {
    if (typeof streamTypes === "string") {
      result = streamTypes
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    } else {
      result = [...streamTypes];
    }
  }
  if (includeOrderUpdates && !result.includes("order_update")) {
    result.push("order_update");
  }
  return result;
}
