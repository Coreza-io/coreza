export type ManualExecutionUnavailableReason =
  | "attachment"
  | "unsupported"
  | "unknown";

export type ManualExecutionCapability =
  | { available: true }
  | { available: false; reason: ManualExecutionUnavailableReason };

/** Preserve the editor's existing node-type contract without persisting UI capability state. */
export function resolveManualExecution(
  definition: unknown,
): ManualExecutionCapability {
  if (!definition || typeof definition !== "object") {
    return { available: false, reason: "unknown" };
  }
  const { name, node_type: nodeType } = definition as Record<string, unknown>;
  if (typeof name !== "string" || name.length === 0) {
    return { available: false, reason: "unknown" };
  }
  if (nodeType === "sub") return { available: false, reason: "attachment" };
  if (name === "Visualize") return { available: false, reason: "unsupported" };
  return nodeType === "main" || nodeType === "action" || nodeType === "trigger" || nodeType === "backtest"
    ? { available: true }
    : { available: false, reason: "unknown" };
}
