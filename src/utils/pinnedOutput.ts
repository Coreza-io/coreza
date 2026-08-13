/** Maximum serialized size of a pinned output included in a workflow. */
export const MAX_PINNED_OUTPUT_BYTES = 256 * 1024;

export function safePinnedOutput(value: unknown): unknown | undefined {
  if (value === undefined || value === null) return undefined;

  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > MAX_PINNED_OUTPUT_BYTES
    ) {
      console.warn(
        `[Workflow] Pinned output was omitted because it exceeds ${MAX_PINNED_OUTPUT_BYTES} bytes.`,
      );
      return undefined;
    }
  } catch {
    console.warn('[Workflow] Pinned output was omitted because it is not JSON-serializable.');
    return undefined;
  }

  return value;
}
