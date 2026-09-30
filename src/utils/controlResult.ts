export type ControlResult =
  | { kind: "selected"; handle: string }
  | { kind: "malformed" };

export type ResolvedControlResult =
  | { kind: "selected"; handle: string }
  | { kind: "terminal"; handle: string }
  | { kind: "malformed" };

const primitiveHandle = (value: unknown): string | undefined =>
  typeof value === "boolean" || (typeof value === "string" && value.length > 0)
    ? String(value)
    : undefined;

/** Decodes only the established control-node response contracts. */
export function decodeControlResult(result: unknown): ControlResult {
  const direct = primitiveHandle(result);
  if (direct !== undefined) return { kind: "selected", handle: direct };
  if (!result || typeof result !== "object") return { kind: "malformed" };

  const record = result as Record<string, unknown>;
  if (record.true === true) return { kind: "selected", handle: "true" };
  if (record.false === true) return { kind: "selected", handle: "false" };

  const data = record.data;
  const directData = primitiveHandle(data);
  if (directData !== undefined) return { kind: "selected", handle: directData };
  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    if (dataRecord.true === true) return { kind: "selected", handle: "true" };
    if (dataRecord.false === true) return { kind: "selected", handle: "false" };
    const nestedResult = primitiveHandle(dataRecord.result);
    if (nestedResult !== undefined) return { kind: "selected", handle: nestedResult };
  }
  const wrapped = primitiveHandle(record.result) ?? primitiveHandle(record.output);
  return wrapped !== undefined
    ? { kind: "selected", handle: wrapped }
    : { kind: "malformed" };
}

/** Compatibility helper for callers that still use an empty string as malformed. */
export const getControlResultHandle = (result: unknown): string => {
  const decoded = decodeControlResult(result);
  return decoded.kind === "selected" ? decoded.handle : "";
};

export function resolveControlResult(
  result: unknown,
  connectedHandles: ReadonlySet<string>,
): ResolvedControlResult {
  const decoded = decodeControlResult(result);
  if (decoded.kind === "malformed") return decoded;
  return connectedHandles.has(decoded.handle)
    ? decoded
    : { kind: "terminal", handle: decoded.handle };
}
