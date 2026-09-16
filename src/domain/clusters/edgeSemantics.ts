import type { Edge, Node } from '@xyflow/react';
import type { SemanticEdgeKind } from './validate';

interface ClusterHandleDefinition {
  id?: unknown;
  type?: unknown;
  connectionKind?: unknown;
}

interface ClusterNodeDefinition {
  node_type?: unknown;
  handles?: unknown;
}

const getDefinition = (node: Node | undefined): ClusterNodeDefinition | undefined => {
  const definition = node?.data?.definition;
  return typeof definition === 'object' && definition !== null
    ? definition as ClusterNodeDefinition
    : undefined;
};

const getHandle = (
  definition: ClusterNodeDefinition | undefined,
  id: string | null | undefined,
  type: 'source' | 'target',
): ClusterHandleDefinition | undefined => {
  if (!definition || !Array.isArray(definition.handles)) return undefined;
  return definition.handles.find((handle): handle is ClusterHandleDefinition => {
    if (typeof handle !== 'object' || handle === null) return false;
    const candidate = handle as ClusterHandleDefinition;
    return candidate.id === id && candidate.type === type;
  });
};

/** Resolves execution semantics from node definitions and explicit handle metadata. */
export function getClusterEdgeKind(
  edge: Edge,
  source: Node | undefined,
  target: Node | undefined,
): SemanticEdgeKind | undefined {
  const sourceDefinition = getDefinition(source);
  const targetDefinition = getDefinition(target);
  if (!sourceDefinition || !targetDefinition) return undefined;

  const sourceHandle = getHandle(sourceDefinition, edge.sourceHandle, 'source');
  const targetHandle = getHandle(targetDefinition, edge.targetHandle, 'target');
  const explicitKinds = [sourceHandle?.connectionKind, targetHandle?.connectionKind]
    .filter((kind): kind is SemanticEdgeKind => kind === 'main' || kind === 'attachment');

  if (new Set(explicitKinds).size > 1) return undefined;
  if (explicitKinds.length > 0) return explicitKinds[0];

  // Dynamic branch handles are execution paths. Attachment handles are always
  // explicitly marked, so an otherwise known pair is a main connection.
  return sourceDefinition.node_type === 'sub' ? undefined : 'main';
}

export function isTriggerNode(node: Node): boolean {
  return getDefinition(node)?.node_type === 'trigger';
}
