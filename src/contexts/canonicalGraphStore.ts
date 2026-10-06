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
): { snapshot: SemanticGraphSnapshot; signatures: SemanticSignatures } {
  const semanticNodes: readonly SemanticNode[] = Object.freeze(nodes.map(({ id, type, data }) => Object.freeze({
    id,
    type,
    data: Object.freeze({ ...data }),
  })));
  const semanticEdges: readonly SemanticEdge[] = Object.freeze(edges.map(({
    id, source, target, sourceHandle, targetHandle, type, data,
  }) => Object.freeze({
    id, source, target, sourceHandle, targetHandle, type,
    data: data ? Object.freeze({ ...data }) : undefined,
  })));
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
    const upstream = [...result.values()];
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

export function createCanonicalGraphStore(): CanonicalGraphStore {
  let snapshot = EMPTY_CANONICAL_GRAPH;
  let semanticSnapshot = EMPTY_SEMANTIC_GRAPH;
  let semanticSignatures: SemanticSignatures = { nodeData: [], edgeData: [] };
  let currentSessionId: string | undefined;
  const listeners = new Set<() => void>();
  const semanticListeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getSemanticSnapshot: () => semanticSnapshot,
    publish: (nodes, edges, sessionId) => {
      const fullChanged = snapshot.nodes !== nodes || snapshot.edges !== edges;
      if (fullChanged) {
        snapshot = { nodes, edges };
        listeners.forEach((listener) => listener());
      }
      const sessionChanged = currentSessionId !== sessionId;
      currentSessionId = sessionId;
      const semanticChanged = sessionChanged
        || semanticSnapshot.nodes.length !== nodes.length
        || semanticSnapshot.edges.length !== edges.length
        || nodes.some((node, index) => !sameSemanticNode(semanticSnapshot.nodes[index], semanticSignatures.nodeData[index], node))
        || edges.some((edge, index) => !sameSemanticEdge(semanticSnapshot.edges[index], semanticSignatures.edgeData[index], edge));
      if (!semanticChanged) return;
      const nextSemantic = createSemanticSnapshot(nodes, edges);
      semanticSnapshot = nextSemantic.snapshot;
      semanticSignatures = nextSemantic.signatures;
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
