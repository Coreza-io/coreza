import { allocateNodeName } from "@/domain/nodeNaming";
import { mapNodeReferences, remapNodeReferenceMap } from "@/utils/remapNodeReferences";
import { resolveNodeIdentity, withUniqueInstanceAliases } from "@/utils/referenceResolution";
import { nodeManifest } from "@/nodes/manifest";
import { validateClusters } from "@/domain/clusters/validate";
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
import type { NodeCluster } from '@/domain/clusters/types';
import { normalizeClusters } from '@/domain/clusters/validate';
import { parseNodeClusters } from '@/domain/clusters/parse';
import { serializeWorkflowContent } from '@/domain/workflowDocument';

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
  content?: ReturnType<typeof serializeWorkflowContent>;
}

export function exportWorkflow(
  name: string,
  nodes: Node[],
  edges: Edge[],
  isActive: boolean,
  clusters: readonly NodeCluster[] = [],
) {
  const content = serializeWorkflowContent(name, null, nodes, edges, clusters);

  const exported: ExportedWorkflow = {
    meta: {
      exportedAt: new Date().toISOString(),
      version: '2.0',
      source: 'coreza',
    },
    name,
    nodes: content.nodes.map((node) => ({
      ...node,
      type: typeof node.name === 'string' ? node.name : 'unknown',
    })) as ExportedWorkflow['nodes'],
    edges: content.edges as ExportedWorkflow['edges'],
    isActive,
    clusters: content.clusters,
    content,
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
  const portableContent = typeof parsed.content === 'object' && parsed.content !== null ? parsed.content : undefined;
  const importedNodes = portableContent?.nodes ?? parsed.nodes;
  const importedEdges = portableContent?.edges ?? parsed.edges;
  const importedClusters = portableContent?.clusters ?? parsed.clusters;
  if (!Array.isArray(importedNodes)) {
    throw new Error('Workflow file is missing nodes');
  }
  if (!Array.isArray(importedEdges)) {
    throw new Error('Workflow file is missing edges');
  }
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    throw new Error('Workflow file is missing a name');
  }
  const normalizedNodes = importedNodes.map((value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('Workflow file contains an invalid node');
    const node = value as Record<string, unknown>;
    if (typeof node.id !== 'string' || typeof node.position !== 'object' || node.position === null) {
      throw new Error('Workflow file contains an invalid node');
    }
    const position = node.position as Record<string, unknown>;
    if (typeof position.x !== 'number' || typeof position.y !== 'number') throw new Error('Workflow file contains an invalid node position');
    const type = typeof node.type === 'string' ? node.type : node.name;
    if (typeof type !== 'string') throw new Error('Workflow file contains an invalid node type');
    return { ...node, id: node.id, type, position: { x: position.x, y: position.y } };
  }) as ExportedWorkflow['nodes'];
  const parsedClusters = parseNodeClusters(importedClusters);
  const ids = new Set(normalizedNodes.map((node) => node.id));
  if (ids.size !== normalizedNodes.length) throw new Error("Workflow file contains duplicate node IDs");
  const edgeIds = new Set<string>();
  for (const edge of importedEdges) {
    if (!edge || typeof edge.id !== "string" || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error("Workflow file contains an invalid connection");
    }
    edgeIds.add(edge.id);
  }
  const validationNodes: Node[] = normalizedNodes.map((node) => ({
    ...node, data: { values: node.values, definition: nodeManifest[node.type as keyof typeof nodeManifest] },
  }));
  const validation = validateClusters(validationNodes, importedEdges, parsedClusters.clusters);
  if (!validation.valid) throw new Error(validation.violations[0].message);
  // Validate references before allocating public names could hide ambiguity.
  for (const node of normalizedNodes) {
    mapNodeReferences(node.values, (name) => {
      resolveNodeIdentity(name, normalizedNodes);
      return undefined;
    });
  }
  const idMap = Object.fromEntries(normalizedNodes.map((node) => [node.id, crypto.randomUUID()]));
  const references = withUniqueInstanceAliases(idMap, normalizedNodes);
  const reservations = new Set<string>();
  const freshNodes = normalizedNodes.map((node) => {
    const result = allocateNodeName(node.displayName?.trim() ? node.displayName : node.id, [], undefined, reservations);
    if (result.ok === false) throw new Error(result.message);
    reservations.add(result.name);
    return {
      ...node, id: idMap[node.id], displayName: result.name,
      values: remapNodeReferenceMap(node.values, references),
    };
  });
  const freshEdges = importedEdges.map((edge) => ({
    ...edge, id: crypto.randomUUID(), source: idMap[edge.source], target: idMap[edge.target],
  }));
  const freshClusters = parsedClusters.clusters.map((cluster) => ({
    ...cluster, memberNodeIds: cluster.memberNodeIds.map((id) => idMap[id]),
  }));

  const clusterDiagnostics = parsedClusters.invalidIndexes.map((index) =>
    `Cluster metadata entry ${index + 1} is invalid and was not loaded.`);

  return {
    name: parsed.name,
    nodes: freshNodes,
    edges: freshEdges,
    isActive: parsed.isActive ?? false,
    clusters: normalizeClusters(freshClusters),
    clusterDiagnostics,
    invalidClusterEntries: parsedClusters.invalidEntries,
  };
}
