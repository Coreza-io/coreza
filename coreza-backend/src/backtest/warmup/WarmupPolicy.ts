import { resolveCategory } from "../../nodes/categoryMap";
import type { NodeResult, WorkflowNode } from "../../nodes/types";
import type { WarmupNodePolicy } from "./types";

/**
 * Warm-up node policy.
 *
 * Matching is exact on the *definition* identity (`node.name` from the node
 * JSON, plus the resolved category) — never substring matching on the user's
 * label, which would reject a Compute node named "CheckOrderCount".
 *
 * Anything unmatched defaults to `suppress`: a new node type is far more
 * likely to be a side-effecting integration than a state accumulator.
 */

/** Categories whose nodes are pure state-builders and must run during warm-up. */
const EXECUTE_CATEGORIES = new Set(["indicators", "controlflow", "logic"]);

/** Explicit per-node allow list (definition names, lowercased). */
const EXECUTE_NODES = new Set([
  "rollingwindow",
  "initializeindicators",
  "compute",
  "if",
  "switch",
  "loop",
  "edit fields",
  "onbar",
]);

/** Nodes/categories that would create or mutate trading state. */
const REJECT_CATEGORIES = new Set([
  "broker",
  "portfolio",
  "risk management",
  "trading",
]);
const REJECT_NODES = new Set([
  "backtesttrade",
  "backtestportfolio",
  "portfolio",
  "risk engine",
]);

export function resolveWarmupPolicy(node: WorkflowNode): WarmupNodePolicy {
  const category = (resolveCategory(node) ?? "").toLowerCase().trim();
  const nodeName = (node.name ?? node.type ?? "").toLowerCase().trim();

  if (REJECT_CATEGORIES.has(category) || REJECT_NODES.has(nodeName)) {
    return "reject";
  }

  if (EXECUTE_NODES.has(nodeName) || EXECUTE_CATEGORIES.has(category)) {
    return "execute";
  }

  // Everything else — data sources, communication, storage, AI, streams,
  // documents — is suppressed: no external calls, no side effects, no cost.
  return "suppress";
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
