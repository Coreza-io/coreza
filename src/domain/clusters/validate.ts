import type { Edge, Node } from '@xyflow/react';
import {
  MAX_CLUSTER_NOTE_LENGTH,
  type ClusterValidationResult,
  type ClusterViolation,
  type ClusterViolationCode,
  type NodeCluster,
} from './types';
import { getClusterEdgeKind, isTriggerNode } from './edgeSemantics';

export type SemanticEdgeKind = 'main' | 'attachment';

export interface ClusterValidationOptions {
  minimumMembers?: number;
  getEdgeKind?: (edge: Edge, source: Node | undefined, target: Node | undefined) => SemanticEdgeKind | undefined;
  isTrigger?: (node: Node) => boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function violation(
  code: ClusterViolationCode,
  message: string,
  clusterId?: string,
  nodeIds: string[] = [],
  edgeIds: string[] = [],
): ClusterViolation {
  return { code, message, clusterId, nodeIds, edgeIds };
}

/** Validates persisted cluster metadata against the canonical executable graph. */
export function validateClusters(
  nodes: readonly Node[],
  edges: readonly Edge[],
  clusters: readonly NodeCluster[],
  options: ClusterValidationOptions = {},
): ClusterValidationResult {
  const violations: ClusterViolation[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const kindOf = options.getEdgeKind ?? getClusterEdgeKind;
  const isTrigger = options.isTrigger ?? isTriggerNode;
  const ids = new Set<string>();
  const titles = new Set<string>();
  const ownerByNode = new Map<string, string>();

  for (const cluster of clusters) {
    if (!UUID_PATTERN.test(cluster.id)) violations.push(violation('invalid-cluster-id', 'Cluster identifiers must be UUIDs.', cluster.id));
    if (ids.has(cluster.id)) violations.push(violation('duplicate-cluster-id', 'Cluster identifiers must be unique.', cluster.id));
    ids.add(cluster.id);
    const title = cluster.title.trim();
    if (!title) violations.push(violation('empty-title', 'Cluster title cannot be empty.', cluster.id));
    else if (titles.has(title.toLocaleLowerCase())) violations.push(violation('duplicate-title', 'Cluster titles must be unique.', cluster.id));
    titles.add(title.toLocaleLowerCase());
    if ((cluster.note?.length ?? 0) > MAX_CLUSTER_NOTE_LENGTH) {
      violations.push(violation('note-too-long', `Cluster notes cannot exceed ${MAX_CLUSTER_NOTE_LENGTH} characters.`, cluster.id));
    }
    if (cluster.memberNodeIds.length === 0) violations.push(violation('empty-cluster', 'A cluster must contain a node.', cluster.id));
    const members = new Set<string>();
    for (const nodeId of cluster.memberNodeIds) {
      if (members.has(nodeId)) violations.push(violation('duplicate-member', 'A node can appear only once in a cluster.', cluster.id, [nodeId]));
      members.add(nodeId);
      if (!nodeById.has(nodeId)) violations.push(violation('missing-member', 'A cluster member does not exist in this workflow.', cluster.id, [nodeId]));
      const owner = ownerByNode.get(nodeId);
      if (owner && owner !== cluster.id) violations.push(violation('overlapping-membership', 'A node can belong to only one cluster.', cluster.id, [nodeId]));
      else ownerByNode.set(nodeId, cluster.id);
      const node = nodeById.get(nodeId);
      if (node && isTrigger(node)) violations.push(violation('trigger-member', 'Trigger nodes cannot be clustered.', cluster.id, [nodeId]));
    }
    validateTopology(cluster, members, edges, nodeById, kindOf, violations);
  }
  return { valid: violations.length === 0, violations };
}

function validateTopology(
  cluster: NodeCluster,
  members: ReadonlySet<string>,
  edges: readonly Edge[],
  nodeById: ReadonlyMap<string, Node>,
  kindOf: NonNullable<ClusterValidationOptions['getEdgeKind']>,
  violations: ClusterViolation[],
): void {
  if (members.size === 0 || [...members].some((id) => !nodeById.has(id))) return;
  const adjacency = new Map([...members].map((id) => [id, new Set<string>()]));
  const internalMain: Edge[] = [];
  const incomingMain: Edge[] = [];
  const outgoingMain: Edge[] = [];
  const incoming = new Set<string>();
  const outgoing = new Set<string>();

  for (const edge of edges) {
    const sourceInside = members.has(edge.source);
    const targetInside = members.has(edge.target);
    if (!sourceInside && !targetInside) continue;
    const kind = kindOf(edge, nodeById.get(edge.source), nodeById.get(edge.target));
    if (!kind) {
      violations.push(violation('unknown-semantics', 'A connection has unknown clustering semantics.', cluster.id, [edge.source, edge.target], [edge.id]));
      continue;
    }
    if (kind === 'attachment' && sourceInside !== targetInside) {
      violations.push(violation('attachment-boundary', 'Attachment connections cannot cross a cluster boundary.', cluster.id, [edge.source, edge.target], [edge.id]));
    }
    if (sourceInside && targetInside) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
      if (kind === 'main') internalMain.push(edge);
    } else if (kind === 'main' && targetInside) { incoming.add(edge.target); incomingMain.push(edge); }
    else if (kind === 'main' && sourceInside) { outgoing.add(edge.source); outgoingMain.push(edge); }
  }

  const first = members.values().next().value as string;
  const visited = new Set<string>([first]);
  const queue = [first];
  while (queue.length) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  if (visited.size !== members.size) violations.push(violation('disconnected-members', 'Cluster members must be connected.', cluster.id, [...members].filter((id) => !visited.has(id))));
  if (incoming.size > 1) violations.push(violation('multiple-entry-members', 'A cluster can expose only one entry member.', cluster.id, [...incoming]));
  if (outgoing.size > 1) violations.push(violation('multiple-exit-members', 'A cluster can expose only one exit member.', cluster.id, [...outgoing]));

  const entry = incoming.size === 1 ? [...incoming][0] : undefined;
  const exit = outgoing.size === 1 ? [...outgoing][0] : undefined;
  const acceptedLoop = entry && exit
    ? isAcceptedLoopBoundary(entry, exit, internalMain, incomingMain, outgoingMain, nodeById)
    : false;
  if (entry && !acceptedLoop && internalMain.some((edge) => edge.target === entry)) violations.push(violation('entry-not-root', 'The cluster entry must be an internal root.', cluster.id, [entry]));
  if (exit && !acceptedLoop && internalMain.some((edge) => edge.source === exit)) violations.push(violation('exit-not-leaf', 'The cluster exit must be an internal leaf.', cluster.id, [exit]));
  if (entry && exit && !hasDirectedPath(entry, exit, internalMain)) violations.push(violation('no-entry-exit-path', 'The cluster entry must connect to its exit.', cluster.id, [entry, exit]));
}

function isAcceptedLoopBoundary(
  entry: string,
  exit: string,
  internalEdges: readonly Edge[],
  incomingEdges: readonly Edge[],
  outgoingEdges: readonly Edge[],
  nodeById: ReadonlyMap<string, Node>,
): boolean {
  if (entry !== exit) return false;
  const definition = nodeById.get(entry)?.data?.definition;
  if (typeof definition !== 'object' || definition === null ||
      (definition as { name?: unknown }).name !== 'Loop') return false;
  if (!incomingEdges.every((edge) => edge.targetHandle == null || edge.targetHandle === 'in')) return false;
  if (!outgoingEdges.every((edge) => edge.sourceHandle === 'done')) return false;
  const loopBranches = internalEdges.filter((edge) => edge.source === entry && edge.sourceHandle === 'loop');
  const returns = internalEdges.filter((edge) => edge.target === entry && (edge.targetHandle == null || edge.targetHandle === 'in'));
  return loopBranches.length === 1 && returns.length >= 1 &&
    returns.some((edge) => hasDirectedPath(loopBranches[0].target, edge.source, internalEdges));
}

function hasDirectedPath(source: string, target: string, edges: readonly Edge[]): boolean {
  if (source === target) return true;
  const seen = new Set([source]);
  const queue = [source];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== current || seen.has(edge.target)) continue;
      if (edge.target === target) return true;
      seen.add(edge.target);
      queue.push(edge.target);
    }
  }
  return false;
}

export function validateClusterSelection(
  selectedNodeIds: readonly string[],
  nodes: readonly Node[],
  edges: readonly Edge[],
  existingClusters: readonly NodeCluster[],
  candidate: NodeCluster,
  options: ClusterValidationOptions = {},
): ClusterValidationResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const kindOf = options.getEdgeKind ?? getClusterEdgeKind;
  const initiallySelected = new Set(selectedNodeIds);
  const members = new Set(initiallySelected);
  const violations: ClusterViolation[] = [];
  const queue = [...members];

  // Attachments flow from dependency (source) to owner (target). Expand only
  // owner -> dependency; traversing both ways can silently add another owner.
  while (queue.length > 0) {
    const memberId = queue.shift()!;
    for (const edge of edges) {
      if (edge.target !== memberId) continue;
      const kind = kindOf(edge, nodeById.get(edge.source), nodeById.get(edge.target));
      if (!kind) {
        violations.push(violation('unknown-semantics', 'This selection contains a connection with unknown clustering semantics.', candidate.id, [edge.source, edge.target], [edge.id]));
        continue;
      }
      if (kind !== 'attachment') continue;
      const dependencyId = edge.source;
      if (!members.has(dependencyId)) {
        members.add(dependencyId);
        queue.push(dependencyId);
      }
    }
  }

  // Every included attachment must be exclusively owned by included nodes,
  // including attachments that were selected directly or found recursively.
  for (const attachmentId of members) {
    const ownershipEdges = edges.filter((edge) => edge.source === attachmentId &&
      kindOf(edge, nodeById.get(edge.source), nodeById.get(edge.target)) === 'attachment');
    const outside = ownershipEdges.filter((edge) => !members.has(edge.target));
    if (ownershipEdges.length > 0 && outside.length > 0) {
      violations.push(violation('shared-attachment',
        'An attachment shared with a node outside the selection cannot be clustered.',
        candidate.id, [attachmentId, ...outside.map((edge) => edge.target)],
        outside.map((edge) => edge.id)));
    }
  }

  const expandedSelection = [...members];
  if (expandedSelection.length < (options.minimumMembers ?? 2)) {
    violations.push(violation('too-few-members', 'Select at least two connected nodes to create a cluster.', candidate.id, expandedSelection));
  }
  if (violations.length > 0) {
    return { valid: false, violations, resolvedMemberNodeIds: expandedSelection };
  }
  return {
    ...validateClusters(nodes, edges, [...existingClusters, { ...candidate, memberNodeIds: expandedSelection }], options),
    resolvedMemberNodeIds: expandedSelection,
  };
}

export function normalizeClusters(clusters: readonly NodeCluster[]): NodeCluster[] {
  return clusters.map((cluster) => ({
    ...cluster,
    title: cluster.title.trim(),
    memberNodeIds: [...new Set(cluster.memberNodeIds)].sort(),
    ...(cluster.note?.trim() ? { note: cluster.note.trim() } : { note: undefined }),
  }));
}
