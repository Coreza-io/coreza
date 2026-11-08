import { isNodeResult } from "../contracts/nodeResult";

export interface ReferenceNode {
  id: string;
  name?: string;
  displayName?: string;
  label?: string;
  data?: unknown;
}

export function pickJsonSource(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;

  // Public .json references address the full result shown in the data panels.
  // Payload fields named input/output are data, not legacy transport envelopes.
  if (isNodeResult(value)) return value;

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

export class AmbiguousNodeReferenceError extends Error {
  readonly code = "ambiguous-node-reference";
  constructor(name: string) {
    super(`Ambiguous node reference "${name}". Use a canonical node ID.`);
    this.name = "AmbiguousNodeReferenceError";
  }
}

export function resolveNodeIdentity(name: string, nodes: readonly ReferenceNode[]): ReferenceNode | undefined {
  const exact = nodes.find((node) => node.id === name);
  if (exact) return exact;
  const explicit = nodes.filter((node) => {
    const data = asRecord(node.data);
    return [node.displayName, data?.displayName].some((alias) => typeof alias === "string" && alias.trim() && alias === name);
  });
  const matches = explicit.length ? explicit : nodes.filter((node) => {
    const data = asRecord(node.data);
    return [node.name, node.label, data?.title, data?.name, data?.label].includes(name);
  });
  const ids = new Set(matches.map((node) => node.id));
  if (ids.size > 1) throw new AmbiguousNodeReferenceError(name);
  return matches[0];
}

export function resolveNodeKey(
  nodeName: string,
  allNodeData?: Readonly<Record<string, unknown>>,
  nodes?: readonly ReferenceNode[],
): string | undefined {
  if (!nodeName) return undefined;
  const candidate = nodes && resolveNodeIdentity(nodeName, nodes);
  const has = (key: string) => allNodeData && Object.prototype.hasOwnProperty.call(allNodeData, key);
  // Exact IDs never fall through to another node's alias or output.
  if (candidate) {
    if (has(candidate.id)) return candidate.id;
    if (candidate.id !== nodeName && has(nodeName)) return nodeName;
    return undefined;
  }
  return has(nodeName) ? nodeName : undefined;
}

export function resolveNodeAlias(nodeName: string, nodes: readonly ReferenceNode[]): string {
  return resolveNodeIdentity(nodeName, nodes)?.id ?? nodeName;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
