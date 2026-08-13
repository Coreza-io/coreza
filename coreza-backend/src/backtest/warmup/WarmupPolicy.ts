import { resolveCategory } from "../../nodes/categoryMap";
import type { NodeResult, WorkflowNode } from "../../nodes/types";
import type { WarmupNodePolicy } from "./types";

const EXECUTE_CATEGORIES = new Set(["indicators", "controlflow", "datasource"]);
const EXECUTE_NODES = new Set([
  "indicators",
  "initializeindicators",
  "rollingwindow",
  "compute",
  "if",
  "switch",
  "loop",
  "edit fields",
]);
const REJECT_TERMS = ["backtesttrade", "portfolio", "broker", "order", "trade"];
const SUPPRESS_TERMS = [
  "telegram",
  "gmail",
  "whatsapp",
  "webhook",
  "notification",
  "storage",
  "documentextract",
  "aiagent",
  "llm",
  "store",
];

export function resolveWarmupPolicy(node: WorkflowNode): WarmupNodePolicy {
  const category = resolveCategory(node).toLowerCase();
  const nodeName = (node.name ?? node.type ?? "").toLowerCase();
  const identity = `${category} ${nodeName}`;
  if (REJECT_TERMS.some((term) => identity.includes(term))) return "reject";
  if (SUPPRESS_TERMS.some((term) => identity.includes(term))) return "suppress";
  return EXECUTE_CATEGORIES.has(category) || EXECUTE_NODES.has(nodeName)
    ? "execute"
    : "suppress";
}

export function enforceWarmupPolicy(
  node: WorkflowNode,
): NodeResult | undefined {
  const policy = resolveWarmupPolicy(node);
  if (policy === "execute") return undefined;
  if (policy === "reject") {
    return {
      success: false,
      data: null,
      code: "ORDER_DURING_WARMUP",
      error: "Trading operations are disabled during warm-up",
    };
  }
  return { success: true, data: null, warmupSuppressed: true };
}
