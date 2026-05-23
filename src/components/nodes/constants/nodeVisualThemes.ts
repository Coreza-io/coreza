/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * Node visual theme tokens. Each category resolves to a full theme:
 * neon (accent), border (rim), glow (halo), background (body gradient),
 * titleColor (text), iconMode (tile style), edgeColor (default outgoing edge).
 */

export type NodeVisualCategory =
  | "action"
  | "utility"
  | "indicator"
  | "logic"
  | "output";

export type NodeIconMode =
  | "ai-badge"
  | "toolbox"
  | "indicator"
  | "branch"
  | "chart";

export interface NodeVisualTheme {
  neon: string;
  border: string;
  glow: string;
  background: string;
  titleColor: string;
  iconMode: NodeIconMode;
  edgeColor: string;
}

export const NODE_VISUAL_THEMES: Record<NodeVisualCategory, NodeVisualTheme> = {
  action: {
    neon: "#c084fc",
    border: "#d946ef",
    glow: "rgba(217,70,239,0.55)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(217,70,239,0.32), transparent 58%), linear-gradient(145deg, rgba(58,18,112,0.96), rgba(19,8,48,0.98))",
    titleColor: "#ffffff",
    iconMode: "ai-badge",
    edgeColor: "#c084fc",
  },
  utility: {
    neon: "#22d3ee",
    border: "#22d3ee",
    glow: "rgba(34,211,238,0.45)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(34,211,238,0.28), transparent 58%), linear-gradient(145deg, rgba(9,72,86,0.95), rgba(4,23,34,0.98))",
    titleColor: "#ffffff",
    iconMode: "toolbox",
    edgeColor: "#22d3ee",
  },
  indicator: {
    neon: "#38bdf8",
    border: "#0ea5e9",
    glow: "rgba(14,165,233,0.50)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(56,189,248,0.28), transparent 58%), linear-gradient(145deg, rgba(13,49,126,0.96), rgba(4,15,55,0.98))",
    titleColor: "#ffffff",
    iconMode: "indicator",
    edgeColor: "#38bdf8",
  },
  logic: {
    neon: "#f59e0b",
    border: "#fbbf24",
    glow: "rgba(245,158,11,0.50)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(245,158,11,0.30), transparent 58%), linear-gradient(145deg, rgba(92,49,7,0.96), rgba(30,16,5,0.98))",
    titleColor: "#ffffff",
    iconMode: "branch",
    edgeColor: "#f59e0b",
  },
  output: {
    neon: "#fb7185",
    border: "#f43f5e",
    glow: "rgba(244,63,94,0.50)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(244,63,94,0.30), transparent 58%), linear-gradient(145deg, rgba(94,12,40,0.96), rgba(32,6,17,0.98))",
    titleColor: "#ffffff",
    iconMode: "chart",
    edgeColor: "#fb7185",
  },
};

export const DEFAULT_NODE_VISUAL_THEME = NODE_VISUAL_THEMES.utility;
