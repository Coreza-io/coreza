/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * Node visual theme tokens by node category.
 */

export type NodeVisualCategory =
  | "AIAgent"
  | "ChatModel"
  | "LLM"
  | "Backtest"
  | "Broker"
  | "Portfolio"
  | "RiskManagement"
  | "Trigger"
  | "Scheduler"
  | "Webhook"
  | "Stream"
  | "Data"
  | "Input"
  | "Indicators"
  | "Logic"
  | "Tool"
  | "Memory"
  | "Screener"
  | "Communication"
  | "Visualization";

export interface NodeVisualTheme {
  neon: string;
  border: string;
  glow: string;
  background: string;
  titleColor: string;
  edgeColor: string;
}

export const NODE_VISUAL_THEMES: Record<NodeVisualCategory, NodeVisualTheme> = {
  AIAgent: {
    neon: "#34d399",
    border: "#10b981",
    glow: "#10b98144",
    background:
      "radial-gradient(circle at 50% 0%, #34d39926, transparent 45%), linear-gradient(145deg, #0b3b31f0, #061612fa)",
    titleColor: "#ffffff",
    edgeColor: "#34d399",
  },
  ChatModel: {
    neon: "#2dd4bf",
    border: "#14b8a6",
    glow: "#14b8a644",
    background:
      "radial-gradient(circle at 50% 0%, #2dd4bf26, transparent 45%), linear-gradient(145deg, #0a3e39f0, #061816fa)",
    titleColor: "#ffffff",
    edgeColor: "#2dd4bf",
  },
  LLM: {
    neon: "#a78bfa",
    border: "#8b5cf6",
    glow: "#8b5cf644",
    background:
      "radial-gradient(circle at 50% 0%, #a78bfa26, transparent 45%), linear-gradient(145deg, #332267f0, #130d28fa)",
    titleColor: "#ffffff",
    edgeColor: "#a78bfa",
  },
  Backtest: {
    neon: "#fb923c",
    border: "#f97316",
    glow: "#f9731644",
    background:
      "radial-gradient(circle at 50% 0%, #fb923c26, transparent 45%), linear-gradient(145deg, #4d2608f0, #1b0d04fa)",
    titleColor: "#ffffff",
    edgeColor: "#fb923c",
  },
  Broker: {
    neon: "#c084fc",
    border: "#a855f7",
    glow: "#a855f744",
    background:
      "radial-gradient(circle at 50% 0%, #c084fc26, transparent 45%), linear-gradient(145deg, #3e1f60f0, #170b24fa)",
    titleColor: "#ffffff",
    edgeColor: "#c084fc",
  },
  Portfolio: {
    neon: "#f472b6",
    border: "#ec4899",
    glow: "#ec489944",
    background:
      "radial-gradient(circle at 50% 0%, #f472b626, transparent 45%), linear-gradient(145deg, #5a1d42f0, #220b19fa)",
    titleColor: "#ffffff",
    edgeColor: "#f472b6",
  },
  RiskManagement: {
    neon: "#fb7185",
    border: "#f43f5e",
    glow: "#f43f5e44",
    background:
      "radial-gradient(circle at 50% 0%, #fb718526, transparent 45%), linear-gradient(145deg, #5c1a2af0, #240a11fa)",
    titleColor: "#ffffff",
    edgeColor: "#fb7185",
  },
  Trigger: {
    neon: "#fbbf24",
    border: "#f59e0b",
    glow: "#f59e0b44",
    background:
      "radial-gradient(circle at 50% 0%, #fbbf2426, transparent 45%), linear-gradient(145deg, #5b3f08f0, #241904fa)",
    titleColor: "#ffffff",
    edgeColor: "#fbbf24",
  },
  Scheduler: {
    neon: "#fde047",
    border: "#eab308",
    glow: "#eab30844",
    background:
      "radial-gradient(circle at 50% 0%, #fde04726, transparent 45%), linear-gradient(145deg, #5b4f09f0, #231f04fa)",
    titleColor: "#ffffff",
    edgeColor: "#fde047",
  },
  Webhook: {
    neon: "#facc15",
    border: "#ca8a04",
    glow: "#ca8a0444",
    background:
      "radial-gradient(circle at 50% 0%, #facc1526, transparent 45%), linear-gradient(145deg, #554108f0, #1f1804fa)",
    titleColor: "#ffffff",
    edgeColor: "#facc15",
  },
  Stream: {
    neon: "#22d3ee",
    border: "#06b6d4",
    glow: "#06b6d444",
    background:
      "radial-gradient(circle at 50% 0%, #22d3ee26, transparent 45%), linear-gradient(145deg, #0b4350f0, #041a1efa)",
    titleColor: "#ffffff",
    edgeColor: "#22d3ee",
  },
  Data: {
    neon: "#38bdf8",
    border: "#0ea5e9",
    glow: "#0ea5e944",
    background:
      "radial-gradient(circle at 50% 0%, #38bdf826, transparent 45%), linear-gradient(145deg, #0e3f5bf0, #061825fa)",
    titleColor: "#ffffff",
    edgeColor: "#38bdf8",
  },
  Input: {
    neon: "#60a5fa",
    border: "#3b82f6",
    glow: "#3b82f644",
    background:
      "radial-gradient(circle at 50% 0%, #60a5fa26, transparent 45%), linear-gradient(145deg, #183a67f0, #081727fa)",
    titleColor: "#ffffff",
    edgeColor: "#60a5fa",
  },
  Indicators: {
    neon: "#818cf8",
    border: "#6366f1",
    glow: "#6366f144",
    background:
      "radial-gradient(circle at 50% 0%, #818cf826, transparent 45%), linear-gradient(145deg, #282f67f0, #0f1228fa)",
    titleColor: "#ffffff",
    edgeColor: "#818cf8",
  },
  Logic: {
    neon: "#94a3b8",
    border: "#64748b",
    glow: "#64748b44",
    background:
      "radial-gradient(circle at 50% 0%, #94a3b826, transparent 45%), linear-gradient(145deg, #2a3340f0, #11161dfa)",
    titleColor: "#ffffff",
    edgeColor: "#94a3b8",
  },
  Memory: {
    neon: "#fbbf24",
    border: "#f59e0b",
    glow: "#f59e0b44",
    background:
      "radial-gradient(circle at 50% 0%, #fbbf2426, transparent 45%), linear-gradient(145deg, #4b3207f0, #1e1404fa)",
    titleColor: "#ffffff",
    edgeColor: "#fbbf24",
  },
  Tool: {
    neon: "#a3e635",
    border: "#84cc16",
    glow: "#84cc1644",
    background:
      "radial-gradient(circle at 50% 0%, #a3e63526, transparent 45%), linear-gradient(145deg, #3d520cf0, #171f05fa)",
    titleColor: "#ffffff",
    edgeColor: "#a3e635",
  },
  Screener: {
    neon: "#4ade80",
    border: "#22c55e",
    glow: "#22c55e44",
    background:
      "radial-gradient(circle at 50% 0%, #4ade8026, transparent 45%), linear-gradient(145deg, #174c2bf0, #091d10fa)",
    titleColor: "#ffffff",
    edgeColor: "#4ade80",
  },
  Communication: {
    neon: "#67e8f9",
    border: "#22d3ee",
    glow: "#22d3ee44",
    background:
      "radial-gradient(circle at 50% 0%, #67e8f926, transparent 45%), linear-gradient(145deg, #0d4450f0, #051b1ffa)",
    titleColor: "#ffffff",
    edgeColor: "#67e8f9",
  },
  Visualization: {
    neon: "#f0abfc",
    border: "#d946ef",
    glow: "#d946ef44",
    background:
      "radial-gradient(circle at 50% 0%, #f0abfc26, transparent 45%), linear-gradient(145deg, #4c1f57f0, #1d0c22fa)",
    titleColor: "#ffffff",
    edgeColor: "#f0abfc",
  },
};

export const DEFAULT_NODE_VISUAL_THEME = NODE_VISUAL_THEMES.Logic;
