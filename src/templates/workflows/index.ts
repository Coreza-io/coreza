/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 * AGPL-3.0-only
 */

import type { Edge, Node } from "@xyflow/react";
import { nodeManifest } from "@/nodes/manifest";
import customJson from "./custom.json";
import backtestJson from "./backtest.json";
import streamJson from "./stream.json";

export type TemplateId = "backtest" | "stream" | "custom";

export interface WorkflowTemplate {
  id: TemplateId;
  title: string;
  description: string;
  icon: string;
  nodes: Node[];
  edges: Edge[];
}

const hydrate = (raw: { nodes: any[]; edges: any[] }): { nodes: Node[]; edges: Edge[] } => {
  const nodes = raw.nodes.map((n) => ({
    ...n,
    data: {
      ...(n.data || {}),
      definition: nodeManifest[n.type as keyof typeof nodeManifest],
    },
  })) as Node[];
  return { nodes, edges: raw.edges as Edge[] };
};

export const workflowTemplates: Record<TemplateId, WorkflowTemplate> = {
  backtest: {
    id: "backtest",
    title: "Backtest",
    description:
      "Historical strategy simulation: BacktestInit → RSI → IF → Portfolio.",
    icon: "/assets/icons/backtest.svg",
    ...hydrate(backtestJson as any),
  },
  stream: {
    id: "stream",
    title: "Stream",
    description: "Live market stream with real-time signals and order routing.",
    icon: "/assets/icons/broker.svg",
    ...hydrate(streamJson as any),
  },
  custom: {
    id: "custom",
    title: "Custom",
    description: "Start from a blank canvas with one starter node.",
    icon: "/assets/icons/compute.svg",
    ...hydrate(customJson as any),
  },
};

export const getTemplate = (id: string | null | undefined): WorkflowTemplate => {
  if (id && id in workflowTemplates) return workflowTemplates[id as TemplateId];
  return workflowTemplates.custom;
};

export const isValidTemplate = (tpl: WorkflowTemplate): boolean =>
  tpl.nodes.every((n) => !!nodeManifest[n.type as keyof typeof nodeManifest]);
