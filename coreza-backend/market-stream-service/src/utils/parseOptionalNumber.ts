/**
 * Parse an optional broker number without turning missing values into zero.
 * Explicit zero and signed values are preserved; blanks and non-finite values
 * remain undefined so they are omitted when events are serialized to JSON.
 */
export function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
