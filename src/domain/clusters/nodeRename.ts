export const RESERVED_CLUSTER_NODE_PREFIX = "__cluster__";

export type RenameNameResult =
  | { ok: true; name: string; changed: boolean }
  | { ok: false; code: "empty" | "too-long" | "invalid-characters" | "reserved"; message: string };

export function resolveNodeRename(
  requestedName: string,
  sourceId: string,
  nodes: readonly { id: string; data?: Record<string, unknown> }[],
): RenameNameResult {
  const trimmed = requestedName.trim();
  if (!trimmed) return { ok: false, code: "empty", message: "Node name cannot be empty." };
  if (trimmed.length > 50) return { ok: false, code: "too-long", message: "Node name must be 50 characters or less." };
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmed)) {
    return { ok: false, code: "invalid-characters", message: "Node name can only contain letters, numbers, spaces, hyphens, and underscores." };
  }
  if (trimmed.startsWith(RESERVED_CLUSTER_NODE_PREFIX)) {
    return { ok: false, code: "reserved", message: "This node name is reserved for cluster display." };
  }

  const source = nodes.find((node) => node.id === sourceId);
  const sourceDisplayName = typeof source?.data?.displayName === "string" ? source.data.displayName : sourceId;
  if (trimmed === sourceId && trimmed === sourceDisplayName) return { ok: true, name: trimmed, changed: false };

  const occupied = new Set<string>();
  for (const node of nodes) {
    if (node.id === sourceId) continue;
    occupied.add(node.id.toLocaleLowerCase());
    if (typeof node.data?.displayName === "string") occupied.add(node.data.displayName.toLocaleLowerCase());
  }

  let name = trimmed;
  let suffix = 1;
  while (occupied.has(name.toLocaleLowerCase())) name = `${trimmed}${suffix++}`;
  return { ok: true, name, changed: name !== sourceId || name !== sourceDisplayName };
}
