import type { Edge, Node } from "@xyflow/react";

export interface CanonicalGraphSnapshot {
  nodes: readonly Node[];
  edges: readonly Edge[];
}

export type SemanticNode = Pick<Node, "id" | "type" | "data">;
export type SemanticEdge = Pick<Edge, "id" | "source" | "target" | "sourceHandle" | "targetHandle" | "type" | "data">;

export interface SemanticGraphSnapshot {
  nodes: readonly SemanticNode[];
  edges: readonly SemanticEdge[];
  getUpstreamNodes: (targetId: string) => readonly SemanticNode[];
}

const EMPTY_NODES = Object.freeze([]) as readonly Node[];
const EMPTY_EDGES = Object.freeze([]) as readonly Edge[];
const EMPTY_CANONICAL_GRAPH: CanonicalGraphSnapshot = Object.freeze({ nodes: EMPTY_NODES, edges: EMPTY_EDGES });
const EMPTY_SEMANTIC_GRAPH: SemanticGraphSnapshot = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  getUpstreamNodes: () => Object.freeze([]),
});

export interface CanonicalGraphStore {
  getSnapshot: () => CanonicalGraphSnapshot;
  getSemanticSnapshot: () => SemanticGraphSnapshot;
  getConfigurationSnapshot: () => SemanticGraphSnapshot;
  getTopologySnapshot: () => SemanticGraphSnapshot;
  getNodeById: (id: string) => Node | undefined;
  getNodeConfigSnapshot: (id: string) => SemanticNode | undefined;
  subscribeConfiguration: (listener: () => void) => () => void;
  subscribeTopology: (listener: () => void) => () => void;
  subscribeNodeConfig: (id: string, listener: () => void) => () => void;
  publish: (nodes: readonly Node[], edges: readonly Edge[], sessionId?: string) => void;
  subscribe: (listener: () => void) => () => void;
  subscribeSemantic: (listener: () => void) => () => void;
}

interface DataSignature {
  reference: object;
  entries: readonly (readonly [string, unknown])[];
}

interface SemanticSignatures {
  nodeData: readonly DataSignature[];
  edgeData: readonly (DataSignature | undefined)[];
}

const dataSignature = (data: Record<string, unknown>): DataSignature => ({
  reference: data,
  entries: Object.entries(data),
});

const sameData = (previous: DataSignature | undefined, next: Record<string, unknown> | undefined): boolean => {
  if (!previous || !next) return previous === undefined && next === undefined;
  if (previous.reference !== next) return false;
  const entries = Object.entries(next);
  return entries.length === previous.entries.length
    && entries.every(([key, value], index) => previous.entries[index][0] === key && previous.entries[index][1] === value);
};

const sameSemanticNode = (previous: SemanticNode, signature: DataSignature, next: Node): boolean =>
  previous.id === next.id && previous.type === next.type && sameData(signature, next.data);

const sameSemanticEdge = (previous: SemanticEdge, signature: DataSignature | undefined, next: Edge): boolean =>
  previous.id === next.id
  && previous.source === next.source
  && previous.target === next.target
  && previous.sourceHandle === next.sourceHandle
  && previous.targetHandle === next.targetHandle
  && previous.type === next.type
  && sameData(signature, next.data);

function createSemanticSnapshot(
  nodes: readonly Node[],
  edges: readonly Edge[],
  previous?: SemanticGraphSnapshot,
): { snapshot: SemanticGraphSnapshot; signatures: SemanticSignatures } {
  const previousNodes = new Map(previous?.nodes.map(node => [node.id, node]));
  const previousEdges = new Map(previous?.edges.map(edge => [edge.id, edge]));
  const semanticNodes: readonly SemanticNode[] = Object.freeze(nodes.map(({ id, type, data }) => {
    const old = previousNodes.get(id);
    return old && old.type === type && shallowEqual(old.data, data) ? old : Object.freeze({ id, type, data: Object.freeze({ ...data }) });
  }));
  const semanticEdges: readonly SemanticEdge[] = Object.freeze(edges.map(edge => {
    const old = previousEdges.get(edge.id);
    const next = { id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, type: edge.type, data: edge.data ? Object.freeze({ ...edge.data }) : undefined };
    return old && old.source === next.source && old.target === next.target && old.sourceHandle === next.sourceHandle && old.targetHandle === next.targetHandle && old.type === next.type && shallowEqual(old.data, next.data) ? old : Object.freeze(next);
  }));
  const nodeById = new Map(semanticNodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, string[]>();
  for (const edge of semanticEdges) {
    const incoming = incomingByTarget.get(edge.target);
    if (incoming) incoming.push(edge.source);
    else incomingByTarget.set(edge.target, [edge.source]);
  }
  const upstreamCache = new Map<string, readonly SemanticNode[]>();
  const getUpstreamNodes = (targetId: string): readonly SemanticNode[] => {
    const cached = upstreamCache.get(targetId);
    if (cached) return cached;
    const visited = new Set<string>();
    const result = new Map<string, SemanticNode>();
    const stack = [targetId];
    while (stack.length > 0) {
      const target = stack.pop();
      if (!target || visited.has(target)) continue;
      visited.add(target);
      for (const source of incomingByTarget.get(target) ?? []) {
        const node = nodeById.get(source);
        if (node && !result.has(source)) result.set(source, node);
        if (!visited.has(source)) stack.push(source);
      }
    }
    const upstream = Object.freeze([...result.values()]);
    upstreamCache.set(targetId, upstream);
    return upstream;
  };
  return {
    snapshot: { nodes: semanticNodes, edges: semanticEdges, getUpstreamNodes },
    signatures: {
      nodeData: nodes.map((node) => dataSignature(node.data)),
      edgeData: edges.map((edge) => edge.data ? dataSignature(edge.data) : undefined),
    },
  };
}

export const RUNTIME_NODE_DATA_KEYS = new Set([
  "input", "loopItems", "output", "executionInput", "executionStatus", "executionDuration", "itemCount", "error",
  "isExecuting", "isStreamingWaiting", "streamDataReceived", "isListening", "isTestListening",
  "isStreamPaused", "isStreamStepping", "lastStreamEntryId", "loopItem", "loopIndex", "aggregated",
]);

const shallowEqual = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): boolean => {
  if (!a || !b) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
};

const configurationNode = (node: Node): Node => ({ ...node, data: Object.fromEntries(
  Object.entries(node.data).filter(([key]) => !RUNTIME_NODE_DATA_KEYS.has(key)),
) });

// Structural roles and dynamic handles matter; ordinary values, geometry and results do not.
const topologyNode = (node: Node): Node => {
  const values = (node.data.fieldState ?? node.data.values ?? {}) as Record<string, unknown>;
  const cases = Array.isArray(values.cases) ? values.cases : [];
  return { ...node, data: {
    definition: node.data.definition,
    displayName: node.data.displayName,
    tool: values.__isTool,
    handles: JSON.stringify(cases.map(item => ({ outputName: item?.outputName, caseName: item?.caseName, caseValue: item?.caseValue }))),
    enableFallback: values.enableFallback,
    defaultCase: values.defaultCase,
    loopWaits: node.data.loopWaits,
  } };
};

const reuseGraph = (previous: SemanticGraphSnapshot, nodes: readonly Node[], edges: readonly Edge[]): SemanticGraphSnapshot => {
  const next = createSemanticSnapshot(nodes, edges, previous).snapshot;
  return previous.nodes.length === next.nodes.length && previous.edges.length === next.edges.length
    && previous.nodes.every((node, index) => node === next.nodes[index])
    && previous.edges.every((edge, index) => edge === next.edges[index]) ? previous : next;
};

export function createCanonicalGraphStore(): CanonicalGraphStore {
  let snapshot = EMPTY_CANONICAL_GRAPH;
  let semanticSnapshot = EMPTY_SEMANTIC_GRAPH;
  let semanticSignatures: SemanticSignatures = { nodeData: [], edgeData: [] };
  let configurationSnapshot = EMPTY_SEMANTIC_GRAPH;
  let topologySnapshot = EMPTY_SEMANTIC_GRAPH;
  let nodeById = new Map<string, Node>();
  let configById = new Map<string, SemanticNode>();
  const configListeners = new Set<() => void>();
  const topologyListeners = new Set<() => void>();
  const nodeConfigListeners = new Map<string, Set<() => void>>();
  let currentSessionId: string | undefined;
  const listeners = new Set<() => void>();
  const semanticListeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getSemanticSnapshot: () => semanticSnapshot,
    getConfigurationSnapshot: () => configurationSnapshot,
    getTopologySnapshot: () => topologySnapshot,
    getNodeById: id => nodeById.get(id),
    getNodeConfigSnapshot: id => configById.get(id),
    subscribeConfiguration: listener => { configListeners.add(listener); return () => { configListeners.delete(listener); }; },
    subscribeTopology: listener => { topologyListeners.add(listener); return () => { topologyListeners.delete(listener); }; },
    subscribeNodeConfig: (id, listener) => {
      const listeners = nodeConfigListeners.get(id) ?? new Set<() => void>();
      listeners.add(listener); nodeConfigListeners.set(id, listeners);
      return () => { listeners.delete(listener); if (!listeners.size) nodeConfigListeners.delete(id); };
    },
    publish: (nodes, edges, sessionId) => {
      nodeById = new Map(nodes.map(node => [node.id, node]));
      const fullChanged = snapshot.nodes !== nodes || snapshot.edges !== edges;
      if (fullChanged) {
        snapshot = { nodes, edges };
      }
      const sessionChanged = currentSessionId !== sessionId;
      currentSessionId = sessionId;
      const semanticChanged = sessionChanged
        || semanticSnapshot.nodes.length !== nodes.length
        || semanticSnapshot.edges.length !== edges.length
        || nodes.some((node, index) => !sameSemanticNode(semanticSnapshot.nodes[index], semanticSignatures.nodeData[index], node))
        || edges.some((edge, index) => !sameSemanticEdge(semanticSnapshot.edges[index], semanticSignatures.edgeData[index], edge));
      if (!semanticChanged) { if (fullChanged) listeners.forEach(listener => listener()); return; }
      const previousConfig = configurationSnapshot;
      configurationSnapshot = reuseGraph(sessionChanged ? EMPTY_SEMANTIC_GRAPH : configurationSnapshot, nodes.map(configurationNode), edges);
      // Edge styling/data are presentation/runtime; only endpoints, type and handles are structural.
      const structuralEdges = edges.map(({ data: _data, ...edge }) => edge);
      const previousTopology = topologySnapshot;
      topologySnapshot = reuseGraph(sessionChanged ? EMPTY_SEMANTIC_GRAPH : topologySnapshot, nodes.map(topologyNode), structuralEdges);
      const previousById = configById;
      configById = new Map(configurationSnapshot.nodes.map(node => [node.id, node]));
      const changedIds = new Set([...previousById.keys(), ...configById.keys()]);
      const nextSemantic = createSemanticSnapshot(nodes, edges, sessionChanged ? undefined : semanticSnapshot);
      semanticSnapshot = nextSemantic.snapshot;
      semanticSignatures = nextSemantic.signatures;
      if (fullChanged) listeners.forEach(listener => listener());
      // All snapshots are installed before any subscriber can observe this publication.
      if (previousConfig !== configurationSnapshot) configListeners.forEach(listener => listener());
      if (previousTopology !== topologySnapshot) topologyListeners.forEach(listener => listener());
      changedIds.forEach(id => { if (previousById.get(id) !== configById.get(id)) nodeConfigListeners.get(id)?.forEach(listener => listener()); });
      semanticListeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeSemantic: (listener) => {
      semanticListeners.add(listener);
      return () => { semanticListeners.delete(listener); };
    },
  };
}
