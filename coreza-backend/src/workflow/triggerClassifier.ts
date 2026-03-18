import { createError } from "../middleware/errorHandler";
import { WorkflowNode } from "../nodes/types";

export type TriggerKind = "scheduler" | "streaming" | "webhook" | "backtest";

export interface ClassifiedTrigger {
  kind: TriggerKind;
  node: WorkflowNode;
}

const STREAMING_NODE_NAMES = new Set([
  "AlpacaNews",
  "AlpacaStreamData",
  "BinanceStreamData",
  "DhanStreamData",
]);

export function classifyTrigger(node: WorkflowNode): TriggerKind | null {
  const workflowNode = node as WorkflowNode & {
    executionMode?: string;
    name?: string;
    subCategory?: string;
  };

  if (workflowNode.node_type === "backtest" || workflowNode.name === "BacktestInit") {
    return "backtest";
  }

  if (workflowNode.name === "Scheduler") {
    return "scheduler";
  }

  if (
    workflowNode.node_type === "trigger" &&
    workflowNode.executionMode === "streaming"
  ) {
    return "streaming";
  }

  if (
    workflowNode.node_type === "trigger" &&
    (workflowNode.executionMode === "webhook_listening" ||
      workflowNode.subCategory === "webhook")
  ) {
    return "webhook";
  }

  return null;
}

export function detectSingleTriggerOrThrow(nodes: WorkflowNode[]): ClassifiedTrigger {
  const triggers: ClassifiedTrigger[] = [];

  for (const node of nodes) {
    const kind = classifyTrigger(node);
    if (kind) {
      triggers.push({ kind, node });
    }
  }

  if (triggers.length === 0) {
    throw createError(
      "No trigger node (Scheduler, Streaming or WebhookTrigger) found in workflow",
      400,
    );
  }

  if (triggers.length > 1) {
    throw createError("Workflow can only contain one trigger node", 400);
  }

  return triggers[0];
}

export function findStreamingDataNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.filter((node) =>
    STREAMING_NODE_NAMES.has(node.name ?? "") || STREAMING_NODE_NAMES.has(node.type ?? ""),
  );
}
