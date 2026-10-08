import { allocateNodeName, nodeDisplayName } from "@/domain/nodeNaming";
export { RESERVED_CLUSTER_NODE_PREFIX } from "@/domain/nodeNaming";

export type RenameNameResult =
  | { ok: true; name: string; changed: boolean }
  | { ok: false; code: "empty" | "too-long" | "invalid-characters" | "reserved"; message: string };

export function resolveNodeRename(
  requestedName: string,
  sourceId: string,
  nodes: readonly { id: string; data?: Record<string, unknown> }[],
): RenameNameResult {
  const result = allocateNodeName(requestedName, nodes, sourceId);
  if (result.ok === false) return result;
  const source = nodes.find((node) => node.id === sourceId);
  return { ...result, changed: result.name !== sourceId || result.name !== (source ? nodeDisplayName(source) : sourceId) };
}
