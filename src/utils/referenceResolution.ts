export {
  pickJsonSource,
  resolveNodeIdentity,
  AmbiguousNodeReferenceError,
  resolveNodeAlias,
  resolveNodeKey,
} from "../../coreza-backend/src/utils/referenceResolution";
export type { ReferenceNode } from "../../coreza-backend/src/utils/referenceResolution";

import { resolveNodeIdentity, type ReferenceNode } from "../../coreza-backend/src/utils/referenceResolution";

/** Extend an identity map only with explicit aliases proven by the original inventory. */
export function withUniqueInstanceAliases(
  idMap: Readonly<Record<string, string>>,
  nodes: readonly ReferenceNode[],
): Record<string, string> {
  const result = { ...idMap };
  for (const node of nodes) {
    if (!Object.prototype.hasOwnProperty.call(idMap, node.id)) continue;
    const data = node.data as Record<string, unknown> | undefined;
    const alias = node.displayName ?? data?.displayName;
    if (typeof alias !== "string" || !alias.trim()) continue;
    try {
      if (resolveNodeIdentity(alias, nodes)?.id === node.id) result[alias] = idMap[node.id];
    } catch { /* Ambiguous legacy aliases must remain unchanged. */ }
  }
  return result;
}

/** Prefer the public name only when it resolves back to this canonical node. */
export function nodeReferenceName(node: ReferenceNode, nodes: readonly ReferenceNode[]): string {
  const data = node.data as Record<string, unknown> | undefined;
  const name = node.displayName ?? data?.displayName;
  if (typeof name === "string" && name.trim()) {
    try {
      if (resolveNodeIdentity(name, nodes)?.id === node.id) return name;
    } catch { /* Ambiguous names require the canonical ID. */ }
  }
  return node.id;
}
