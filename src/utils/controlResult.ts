/** Decodes only known control-node result envelopes into a React Flow handle ID. */
export function getControlResultHandle(result: unknown): string {
  if (typeof result === "boolean" || typeof result === "string") return String(result);
  if (!result || typeof result !== "object") return String(result ?? "");

  const record = result as Record<string, unknown>;
  if (record.true === true) return "true";
  if (record.false === true) return "false";

  const data = record.data;
  if (data && typeof data === "object" && "result" in data) {
    const value = (data as Record<string, unknown>).result;
    if (typeof value === "boolean" || typeof value === "string") return String(value);
  }
  if ("result" in record && (typeof record.result === "boolean" || typeof record.result === "string")) {
    return String(record.result);
  }
  if ("output" in record && (typeof record.output === "boolean" || typeof record.output === "string")) {
    return String(record.output);
  }
  return "";
}
