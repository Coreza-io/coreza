export const RESERVED_CLUSTER_NODE_PREFIX = "__cluster__";

export interface NamedNode {
  id: string;
  data?: Record<string, unknown>;
}

export type NodeNameResult =
  | { ok: true; name: string }
  | { ok: false; code: "empty" | "too-long" | "invalid-characters" | "reserved"; message: string };

export function nodeDisplayName(node: NamedNode): string {
  const name = node.data?.displayName;
  return typeof name === "string" && name.trim() ? name : node.id;
}

/** Reserve instance identities against the complete canonical document. */
export function allocateNodeName(
  requestedName: string,
  nodes: readonly NamedNode[],
  sourceId?: string,
  reservations: ReadonlySet<string> = new Set(),
): NodeNameResult {
  const base = requestedName.trim();
  if (!base) return { ok: false, code: "empty", message: "Node name cannot be empty." };
  if (base.length > 50) return { ok: false, code: "too-long", message: "Node name must be 50 characters or less." };
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(base)) return { ok: false, code: "invalid-characters", message: "Node name can only contain letters, numbers, spaces, hyphens, and underscores." };
  if (base.toLowerCase().startsWith(RESERVED_CLUSTER_NODE_PREFIX)) return { ok: false, code: "reserved", message: "This node name is reserved for cluster display." };
  const key = (name: string) => name.trim().toLowerCase();
  const occupied = new Set([...reservations].map(key));
  for (const node of nodes) {
    if (node.id === sourceId) continue;
    occupied.add(key(node.id));
    occupied.add(key(nodeDisplayName(node)));
  }
  let name = base;
  for (let suffix = 1; occupied.has(key(name)); suffix++) {
    const tail = String(suffix);
    name = base.slice(0, 50 - tail.length) + tail;
  }
  return { ok: true, name };
}
