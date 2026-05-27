import { WorkflowNode } from "./types";

export const CATEGORY_MAP: Record<string, string> = {
  If: "ControlFlow",
  Switch: "ControlFlow",
  "Edit Fields": "ControlFlow",
  Compute: "ControlFlow",
  Loop: "ControlFlow",
  Scheduler: "Utility",
  trigger: "Utility",
  Visualize: "Utility",
  webhook: "Utility",
  httprequest: "Utility",
  Gmail: "Communication",
  WhatsApp: "Communication",
  FinnHub: "DataSource",
  YahooFinance: "DataSource",
  Store: "DataSource",
  RollingWindow: "Indicators",
  LLM: "LLM",
  AIAgent: "AIAgent",
  InitializeIndicators: "Indicators",
  SimpleMemory: "Memory",
  PostgresChatMemory: "Memory",
  RedisChatMemory: "Memory",
};

export function resolveCategory(node: WorkflowNode): string {
  return CATEGORY_MAP[node.name ?? ""] ?? node.category;
}
