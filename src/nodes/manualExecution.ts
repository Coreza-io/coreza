import type { NodeConfig } from "./schemas/nodeSchema";

export type ManualExecutionUnavailableReason =
  | "attachment"
  | "unsupported";

export type ManualExecutionCapability =
  | { available: true }
  | { available: false; reason: ManualExecutionUnavailableReason };

/** Resolve the declarative contract only; mounted UI and backend actions are irrelevant. */
export function resolveManualExecution(
  definition: Pick<NodeConfig, "manualExecution">,
): ManualExecutionCapability {
  return definition.manualExecution === "available"
    ? { available: true }
    : { available: false, reason: definition.manualExecution };
}
