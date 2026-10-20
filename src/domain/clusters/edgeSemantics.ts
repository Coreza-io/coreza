import { effectiveHandles } from '../nodeRoles';
import type { Edge, Node } from '@xyflow/react';
import type { SemanticEdgeKind } from './validate';

interface ClusterHandleDefinition {
  id?: unknown;
  type?: unknown;
  connectionKind?: unknown;
}

interface ClusterNodeDefinition {
  name?: unknown;
  node_type?: unknown;
  handles?: unknown;
}

const getDefinition = (node: Node | undefined): ClusterNodeDefinition | undefined => {
  const definition = node?.data?.definition;
  return typeof definition === 'object' && definition !== null
    ? { ...definition as ClusterNodeDefinition, handles: effectiveHandles(definition, node?.data?.values as Record<string, unknown>) }
    : undefined;
};

const getHandle = (
  definition: ClusterNodeDefinition | undefined,
  id: string | null | undefined,
  type: 'source' | 'target',
): ClusterHandleDefinition | undefined => {
  if (!definition || !Array.isArray(definition.handles)) return undefined;
  const handles = definition.handles.filter((handle): handle is ClusterHandleDefinition => {
    if (typeof handle !== 'object' || handle === null) return false;
    const candidate = handle as ClusterHandleDefinition;
    return candidate.type === type;
  });
  if (id == null) return handles.length === 1 ? handles[0] : undefined;
  return handles.find((handle) => handle.id === id);
};

const isSupportedDynamicSourceHandle = (node: Node | undefined, id: string): boolean => {
  const definition = getDefinition(node);
  if (definition?.name !== 'Switch') return false;
  const values = node?.data?.values;
  if (typeof values !== 'object' || values === null) return false;
  const record = values as Record<string, unknown>;
  const cases = Array.isArray(record.cases) ? record.cases : [];
  const caseIds = cases.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return [`case${index + 1}`];
    const value = item as Record<string, unknown>;
    const candidate = value.outputName ?? value.caseName ?? value.caseValue;
    return [typeof candidate === 'string' && candidate.length > 0 ? candidate : `case${index + 1}`];
  });
  const fallback = typeof record.defaultCase === 'string' ? record.defaultCase : 'fallback';
  return caseIds.includes(id) || (record.enableFallback !== false && id === fallback);
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

  const sourceHandle = getHandle(sourceDefinition, edge.sourceHandle, 'source') ??
    (typeof edge.sourceHandle === 'string' && isSupportedDynamicSourceHandle(source, edge.sourceHandle)
      ? { id: edge.sourceHandle, type: 'source', connectionKind: 'main' }
      : undefined);
  const targetHandle = getHandle(targetDefinition, edge.targetHandle, 'target');
  // An explicitly supplied handle must resolve. Falling through to `main`
  // would make removed or misspelled dynamic handles executable metadata.
  if ((edge.sourceHandle != null && !sourceHandle) || (edge.targetHandle != null && !targetHandle)) {
    return undefined;
  }
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
