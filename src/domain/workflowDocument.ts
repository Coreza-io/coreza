import { effectiveHandles, validateBrokerAttachments } from './nodeRoles';
import type { Edge, Node } from '@xyflow/react';
import type { NodeCluster } from '@/domain/clusters/types';
import { normalizeClusters } from '@/domain/clusters/validate';
import { getVisibleValues } from '@/utils/fieldVisibility';
import { safePinnedOutput } from '@/utils/pinnedOutput';

export interface EditableWorkflowContent {
  name: string;
  projectId: string | null;
  editableSettings: Record<string, never>;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  clusters: NodeCluster[];
}

export interface SaveWorkflowRequest {
  workflowId?: string;
  expectedRevision?: number;
  content: EditableWorkflowContent;
}

export interface SavedWorkflowResponse {
  workflowId: string;
  content: EditableWorkflowContent;
  revision: number;
}

interface PersistedWorkflowRow {
  id: string;
  name: string;
  project_id: string | null;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  node_clusters: NodeCluster[];
  revision: number;
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Creates the sole database/export/dirty-check representation of editor content. */
export function serializeWorkflowContent(
  name: string,
  projectId: string | null,
  nodes: readonly Node[],
  edges: readonly Edge[],
  clusters: readonly NodeCluster[],
): EditableWorkflowContent {
  validateBrokerAttachments(nodes, edges);
  const serializedNodes = nodes.map((node) => {
    const definition = node.data.definition as Record<string, unknown> | undefined;
    const pinnedOutput = safePinnedOutput(node.data.pinnedOutput);
    return {
      id: node.id,
      ...(typeof node.data.displayName === "string" && node.data.displayName.trim() ? { displayName: node.data.displayName } : {}),
      name: definition?.name,
      node_type: definition?.node_type,
      category: definition?.category,
      subCategory: definition?.subCategory,
      provider: definition?.provider,
      position: node.position,
      sourcePosition: node.sourcePosition,
      targetPosition: node.targetPosition,
      values: getVisibleValues(definition, (node.data.values as Record<string, unknown>) ?? {}),
      executionMode: definition?.executionMode,
      streamingConfig: definition?.streamingConfig,
      handles: effectiveHandles(definition, (node.data.values as Record<string, unknown>) ?? {}),
      ...(pinnedOutput !== undefined ? { pinnedOutput } : {}),
    };
  });
  const nodeIds = new Set(serializedNodes.map((node) => node.id));
  if (nodeIds.size !== serializedNodes.length) throw new Error("duplicate-node-id");
  const invalidEdge = edges.find((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
  if (invalidEdge) throw new Error(`invalid-edge-endpoint: ${invalidEdge.id}`);

  const serializedEdges = edges.map((edge) => ({
    id: edge.id,
    type: edge.type,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
    ...(edge.data ? {
      data: cloneJson(Object.fromEntries(
        Object.entries(edge.data).filter(([, value]) => typeof value !== 'function'),
      )),
    } : {}),
  }));

  return cloneJson({
    name: name.trim(),
    projectId,
    editableSettings: {},
    nodes: serializedNodes,
    edges: serializedEdges,
    clusters: normalizeClusters(clusters),
  });
}

export const hashEditableWorkflowContent = (content: EditableWorkflowContent): string =>
  JSON.stringify(content);

export function savedWorkflowFromRow(value: unknown): SavedWorkflowResponse {
  if (typeof value !== 'object' || value === null) throw new Error('invalid-workflow-response');
  const row = value as Partial<PersistedWorkflowRow>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string' ||
      typeof row.revision !== 'number' || !Array.isArray(row.nodes) ||
      !Array.isArray(row.edges) || !Array.isArray(row.node_clusters) ||
      (row.project_id !== null && typeof row.project_id !== 'string')) {
    throw new Error('invalid-workflow-response');
  }
  return {
    workflowId: row.id,
    revision: row.revision,
    content: cloneJson({
      name: row.name,
      projectId: row.project_id,
      editableSettings: {},
      nodes: row.nodes,
      edges: row.edges,
      clusters: normalizeClusters(row.node_clusters),
    }),
  };
}
