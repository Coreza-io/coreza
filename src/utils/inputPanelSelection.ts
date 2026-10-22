interface InputNode {
  id: string;
  data: Record<string, unknown>;
}

const owns = (value: unknown, key: PropertyKey): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key);

export function resolvePreviousNodeId(
  selectedId: string | undefined,
  previousNodes: readonly InputNode[],
  preferredDirectId?: string,
): string | undefined {
  const upstreamIds = new Set(previousNodes.map(({ id }) => id));
  if (selectedId && upstreamIds.has(selectedId)) return selectedId;
  if (preferredDirectId && upstreamIds.has(preferredDirectId)) return preferredDirectId;
  return previousNodes[0]?.id;
}

export function resolveHistoricalNodeId(
  selectedId: string | undefined,
  executions: readonly { nodeId: string }[],
): string | undefined {
  return executions.some(({ nodeId }) => nodeId === selectedId)
    ? selectedId
    : executions[0]?.nodeId;
}

export function resolveLiveInputData(
  selectedId: string | undefined,
  nodes: readonly InputNode[],
  getExecutionData: (nodeId: string) => unknown,
): unknown {
  if (!selectedId) return {};
  const executionData = getExecutionData(selectedId);
  if (owns(executionData, "output")) return executionData.output;
  const nodeData = nodes.find(({ id }) => id === selectedId)?.data;
  if (owns(nodeData, "output")) return nodeData.output;
  if (owns(nodeData, "input")) return nodeData.input;
  return {};
}
