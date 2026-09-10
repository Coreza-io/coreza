export interface ReferenceNode {
  id: string;
  name?: string;
  label?: string;
  data?: unknown;
}

export function pickJsonSource(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;

  const data = value as Record<string, unknown>;
  const output = asRecord(data.output);
  const input = asRecord(data.input);
  const wrapper = asRecord(data.data);
  const wrappedOutput = asRecord(wrapper?.output);
  const wrappedInput = asRecord(wrapper?.input);

  const candidates = [
    data.json,
    output?.json,
    data.output,
    input?.json,
    data.input,
    wrappedOutput?.json,
    wrapper?.output,
    wrappedInput?.json,
    wrapper?.input,
    value,
  ];
  return candidates.find((candidate) => candidate !== undefined);
}

export function resolveNodeKey(
  nodeName: string,
  allNodeData?: Readonly<Record<string, unknown>>,
  nodes?: readonly ReferenceNode[],
): string | undefined {
  if (!nodeName) return undefined;
  if (
    allNodeData &&
    Object.prototype.hasOwnProperty.call(allNodeData, nodeName)
  ) {
    return nodeName;
  }

  const candidate = nodes?.find((node) => {
    const data = asRecord(node.data);
    return (
      node.id === nodeName ||
      node.label === nodeName ||
      node.name === nodeName ||
      data?.title === nodeName ||
      data?.name === nodeName ||
      data?.label === nodeName ||
      data?.displayName === nodeName
    );
  });

  return candidate &&
    allNodeData &&
    Object.prototype.hasOwnProperty.call(allNodeData, candidate.id)
    ? candidate.id
    : undefined;
}

export function resolveNodeAlias(
  nodeName: string,
  nodes: readonly ReferenceNode[],
): string {
  const candidate = nodes.find((node) => {
    const data = asRecord(node.data);
    return (
      node.id === nodeName ||
      node.label === nodeName ||
      node.name === nodeName ||
      data?.title === nodeName ||
      data?.name === nodeName ||
      data?.label === nodeName ||
      data?.displayName === nodeName
    );
  });
  return candidate?.id ?? nodeName;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
