/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Node, Edge } from '@xyflow/react';
import { safePinnedOutput } from '@/utils/pinnedOutput';
import type { NodeCluster } from '@/domain/clusters/types';
import { normalizeClusters } from '@/domain/clusters/validate';
import { parseNodeClusters } from '@/domain/clusters/parse';

interface ExportedWorkflow {
  meta: {
    exportedAt: string;
    version: string;
    source: string;
  };
  name: string;
  nodes: Array<{
    id: string;
    type: string;
    category?: string;
    subCategory?: string;
    position: { x: number; y: number };
    values?: Record<string, any>;
    displayName?: string;
    pinnedOutput?: unknown;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  isActive: boolean;
  clusters?: NodeCluster[];
}

export function exportWorkflow(
  name: string,
  nodes: Node[],
  edges: Edge[],
  isActive: boolean,
  clusters: readonly NodeCluster[] = [],
) {
  const minimalNodes = nodes.map((node) => {
    const def = node.data?.definition as any;
    const pinnedOutput = safePinnedOutput(node.data?.pinnedOutput);
    return {
      id: node.id,
      type: def?.name || node.type || 'unknown',
      category: def?.category,
      subCategory: def?.subCategory,
      position: node.position,
      values: (node.data as any)?.values || (node.data as any)?.fieldState,
      displayName: (node.data as any)?.label || def?.displayName,
      ...(pinnedOutput !== undefined ? { pinnedOutput } : {}),
    };
  });

  const minimalEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }));

  const exported: ExportedWorkflow = {
    meta: {
      exportedAt: new Date().toISOString(),
      version: '1.1',
      source: 'coreza',
    },
    name,
    nodes: minimalNodes,
    edges: minimalEdges,
    isActive,
    clusters: normalizeClusters(clusters),
  };

  const json = JSON.stringify(exported, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'workflow';

  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importWorkflow(file: File): Promise<{
  name: string;
  nodes: ExportedWorkflow['nodes'];
  edges: ExportedWorkflow['edges'];
  isActive: boolean;
  clusters: NodeCluster[];
  clusterDiagnostics: string[];
  invalidClusterEntries: Array<{ index: number; value: unknown }>;
}> {
  const text = await file.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file');
  }

  if (!parsed.meta || parsed.meta.source !== 'coreza') {
    throw new Error('Not a valid Coreza workflow file');
  }
  if (!Array.isArray(parsed.nodes)) {
    throw new Error('Workflow file is missing nodes');
  }
  if (!Array.isArray(parsed.edges)) {
    throw new Error('Workflow file is missing edges');
  }
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    throw new Error('Workflow file is missing a name');
  }
  const parsedClusters = parseNodeClusters(parsed.clusters);
  const clusterDiagnostics = parsedClusters.invalidIndexes.map((index) =>
    `Cluster metadata entry ${index + 1} is invalid and was not loaded.`);

  return {
    name: parsed.name,
    nodes: parsed.nodes,
    edges: parsed.edges,
    isActive: parsed.isActive ?? false,
    clusters: normalizeClusters(parsedClusters.clusters),
    clusterDiagnostics,
    invalidClusterEntries: parsedClusters.invalidEntries,
  };
}
