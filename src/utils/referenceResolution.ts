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
