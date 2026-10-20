import { effectiveHandles, validateBrokerAttachments } from "./nodeRoles";
import { loadNodeDefinition } from "../nodes/nodeDefinitions";
import { resolveClusterHierarchy } from './clusterHierarchy';
import { createError } from "../middleware/errorHandler";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NOTE_LENGTH = 200;

export interface PersistedHandle {
  id?: unknown;
  type?: unknown;
  connectionKind?: unknown;
}

export interface PersistedNode {
  id?: unknown;
  name?: unknown;
  node_type?: unknown;
  handles?: unknown;
  values?: unknown;
}

export interface PersistedEdge {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  sourceHandle?: unknown;
  targetHandle?: unknown;
}

export interface PersistedNodeCluster {
  id: string;
  title: string;
  parentClusterId?: string;
  note?: string;
  memberNodeIds: string[];
}

interface ClusterDocument {
  nodes: PersistedNode[];
  edges: PersistedEdge[];
  node_clusters: PersistedNodeCluster[];
}

function invalid(code: string): never {
  throw createError(code, 400);
}

function handleKind(node: PersistedNode, handleId: unknown, type: "source" | "target"): "main" | "attachment" | undefined {
  const trusted = typeof node.name === 'string' && ['Alpaca','Schwab','Binance','Dhan','BacktestInit'].includes(node.name) ? loadNodeDefinition(node.name) : undefined;
  const handles = trusted ? effectiveHandles(trusted, node.values as Record<string, any>) : Array.isArray(node.handles) ? node.handles as PersistedHandle[] : [];
  // Legacy rows predate persisted handle definitions. Preserve their known
  // main/sub-node semantics until they are rewritten by the canonical serializer.
  if (handles.length === 0) return node.node_type === "sub" ? "attachment" : "main";
  const candidates = handles.filter((handle) => handle.type === type);
  const handle = typeof handleId === "string"
    ? candidates.find((candidate) => candidate.id === handleId)
    : candidates.length === 1 ? candidates[0] : undefined;
  if (handle?.connectionKind === "main" || handle?.connectionKind === "attachment") return handle.connectionKind;
  if (typeof handleId === "string" && node.name === "Switch" && type === "source") return "main";
  if (handleId != null && !handle) return undefined;
  return node.node_type === "sub" ? undefined : "main";
}

export function getPersistedEdgeKind(edge: PersistedEdge, source: PersistedNode, target: PersistedNode): "main" | "attachment" | undefined {
  if ((!Array.isArray(source.handles) || source.handles.length === 0) && source.node_type === "sub") {
    return "attachment";
  }
  const sourceKind = handleKind(source, edge.sourceHandle, "source");
  const targetKind = handleKind(target, edge.targetHandle, "target");
  if (!sourceKind || !targetKind || sourceKind !== targetKind) return undefined;
  return sourceKind;
}

/** Validates and normalizes the complete candidate passed to the atomic writer. */
export function validateNodeClusterDocument(document: ClusterDocument, options: { requireConnectedMembers?: boolean } = {}): PersistedNodeCluster[] {
  const nodeById = new Map<string, PersistedNode>();
  for (const node of document.nodes) {
    if (typeof node.id !== "string" || nodeById.has(node.id)) invalid("invalid-node-id");
    nodeById.set(node.id, node);
  }
  for (const edge of document.edges) {
    if (typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string" ||
        !nodeById.has(edge.source) || !nodeById.has(edge.target)) invalid("invalid-edge-endpoint");
  }

  try { validateBrokerAttachments(document.nodes, document.edges); }
  catch (error) { invalid(error instanceof Error ? error.message : 'invalid-broker-attachment'); }
  const hierarchy = resolveClusterHierarchy(document.node_clusters, nodeById.keys());
  if (hierarchy.diagnostics.length) invalid(hierarchy.diagnostics[0].code);
  const clusterIds = new Set<string>();
  const titles = new Set<string>();
  const owners = new Set<string>();
  const normalized = document.node_clusters.map((cluster) => {
    const title = cluster.title.trim();
    const note = cluster.note?.trim();
    const titleKey = title.toLocaleLowerCase();
    if (!UUID_PATTERN.test(cluster.id)) invalid("invalid-cluster-id");
    if (clusterIds.has(cluster.id)) invalid("duplicate-cluster-id");
    if (!title) invalid("empty-title");
    if (titles.has(titleKey)) invalid("duplicate-title");
    if ((note?.length ?? 0) > MAX_NOTE_LENGTH) invalid("note-too-long");
    if (!hierarchy.effectiveMembers.get(cluster.id)?.length) invalid("empty-cluster");
    clusterIds.add(cluster.id);
    titles.add(titleKey);

    const members = new Set<string>();
    for (const nodeId of cluster.memberNodeIds) {
      if (members.has(nodeId)) invalid("duplicate-member");
      if (!nodeById.has(nodeId)) invalid("missing-member");
      if (owners.has(nodeId)) invalid("overlapping-membership");
      if (nodeById.get(nodeId)?.node_type === "trigger") invalid("trigger-member");
      members.add(nodeId);
      owners.add(nodeId);
    }
    validateTopology(new Set(hierarchy.effectiveMembers.get(cluster.id)), document.edges, nodeById, options.requireConnectedMembers ?? false);
    return { id: cluster.id, title, ...(cluster.parentClusterId !== undefined ? { parentClusterId: cluster.parentClusterId } : {}), ...(note ? { note } : {}), memberNodeIds: [...members].sort() };
  });
  return normalized;
}

function validateTopology(
  members: ReadonlySet<string>,
  edges: readonly PersistedEdge[],
  nodeById: ReadonlyMap<string, PersistedNode>,
  requireConnectedMembers: boolean,
): void {
  const adjacency = new Map([...members].map((id) => [id, new Set<string>()]));
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  const internalMain: PersistedEdge[] = [];
  const incomingMain: PersistedEdge[] = [];
  const outgoingMain: PersistedEdge[] = [];
  for (const edge of edges) {
    if (typeof edge.source !== "string" || typeof edge.target !== "string") continue;
    const sourceInside = members.has(edge.source);
    const targetInside = members.has(edge.target);
    if (!sourceInside && !targetInside) continue;
    const kind = getPersistedEdgeKind(edge, nodeById.get(edge.source)!, nodeById.get(edge.target)!);
    if (!kind) invalid("unknown-semantics");
    if (kind === "attachment" && sourceInside !== targetInside) invalid("attachment-boundary");
    if (sourceInside && targetInside) {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
      if (kind === "main") internalMain.push(edge);
    } else if (kind === "main" && targetInside) {
      incoming.add(edge.target);
      incomingMain.push(edge);
    } else if (kind === "main" && sourceInside) {
      outgoing.add(edge.source);
      outgoingMain.push(edge);
    }
  }
  const first = members.values().next().value as string;
  const visited = new Set([first]);
  const queue = [first];
  while (queue.length > 0) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  if (requireConnectedMembers && visited.size !== members.size) invalid("disconnected-members");
  if (incoming.size > 1) invalid("multiple-entry-members");
  if (outgoing.size > 1) invalid("multiple-exit-members");
  const entry = incoming.size === 1 ? [...incoming][0] : undefined;
  const exit = outgoing.size === 1 ? [...outgoing][0] : undefined;
  const loopBoundary = entry && exit
    ? isAcceptedLoopBoundary(entry, exit, internalMain, incomingMain, outgoingMain, nodeById)
    : false;
  if (entry && !loopBoundary && internalMain.some((edge) => edge.target === entry)) invalid("entry-not-root");
  if (exit && !loopBoundary && internalMain.some((edge) => edge.source === exit)) invalid("exit-not-leaf");
  if (entry && exit && !hasDirectedPath(entry, exit, internalMain)) invalid("no-entry-exit-path");
}

function isAcceptedLoopBoundary(
  entry: string,
  exit: string,
  internalEdges: readonly PersistedEdge[],
  incomingEdges: readonly PersistedEdge[],
  outgoingEdges: readonly PersistedEdge[],
  nodeById: ReadonlyMap<string, PersistedNode>,
): boolean {
  if (entry !== exit || nodeById.get(entry)?.name !== "Loop") return false;
  if (!incomingEdges.every((edge) => edge.targetHandle == null || edge.targetHandle === "in")) return false;
  if (!outgoingEdges.every((edge) => edge.sourceHandle === "done")) return false;

  const loopBranches = internalEdges.filter(
    (edge) => edge.source === entry && edge.sourceHandle === "loop",
  );
  const returns = internalEdges.filter(
    (edge) => edge.target === entry && (edge.targetHandle == null || edge.targetHandle === "in"),
  );
  return loopBranches.length === 1 && returns.length >= 1 && returns.some(
    (edge) => typeof loopBranches[0].target === "string" &&
      typeof edge.source === "string" &&
      hasDirectedPath(loopBranches[0].target, edge.source, internalEdges),
  );
}

function hasDirectedPath(source: string, target: string, edges: readonly PersistedEdge[]): boolean {
  if (source === target) return true;
  const seen = new Set([source]);
  const queue = [source];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== current || typeof edge.target !== "string" || seen.has(edge.target)) continue;
      if (edge.target === target) return true;
      seen.add(edge.target);
      queue.push(edge.target);
    }
  }
  return false;
}
