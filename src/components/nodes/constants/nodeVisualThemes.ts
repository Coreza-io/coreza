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
    glow: "rgba(217,70,239,0.28)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(217,70,239,0.15), transparent 45%), linear-gradient(145deg, rgba(40,14,82,0.98), rgba(14,6,36,0.99))",
    titleColor: "#ffffff",
    iconMode: "ai-badge",
    edgeColor: "#c084fc",
  },
  utility: {
    neon: "#22d3ee",
    border: "#22d3ee",
    glow: "rgba(34,211,238,0.22)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(34,211,238,0.12), transparent 45%), linear-gradient(145deg, rgba(7,54,64,0.98), rgba(3,18,28,0.99))",
    titleColor: "#ffffff",
    iconMode: "toolbox",
    edgeColor: "#22d3ee",
  },
  indicator: {
    neon: "#38bdf8",
    border: "#0ea5e9",
    glow: "rgba(14,165,233,0.24)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(56,189,248,0.12), transparent 45%), linear-gradient(145deg, rgba(10,39,96,0.98), rgba(3,12,42,0.99))",
    titleColor: "#ffffff",
    iconMode: "indicator",
    edgeColor: "#38bdf8",
  },
  logic: {
    neon: "#f59e0b",
    border: "#fbbf24",
    glow: "rgba(245,158,11,0.24)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(245,158,11,0.14), transparent 45%), linear-gradient(145deg, rgba(72,38,6,0.98), rgba(24,13,4,0.99))",
    titleColor: "#ffffff",
    iconMode: "branch",
    edgeColor: "#f59e0b",
  },
  output: {
    neon: "#fb7185",
    border: "#f43f5e",
    glow: "rgba(244,63,94,0.26)",
    background:
      "radial-gradient(circle at 50% 0%, rgba(244,63,94,0.14), transparent 45%), linear-gradient(145deg, rgba(74,10,32,0.98), rgba(24,5,13,0.99))",
    titleColor: "#ffffff",
    iconMode: "chart",
    edgeColor: "#fb7185",
  },
};

export const DEFAULT_NODE_VISUAL_THEME = NODE_VISUAL_THEMES.utility;
