import type { Node, NodeChange } from "@xyflow/react";

export const CLUSTER_RUNTIME_HOST_CLASS = "cluster-runtime-host";

const PROJECTION_STYLE_KEYS = new Set([
  "visibility",
  "pointerEvents",
  "transition",
  "animation",
]);

/** Removes only presentation attributes owned by collapsed-cluster projection. */
export function repairProjectedClusterNode(node: Node): Node {
  const classTokens = String(node.className ?? "")
    .split(/\s+/)
    .filter((token) => token && token !== CLUSTER_RUNTIME_HOST_CLASS);
  const wasProjected = classTokens.length !== String(node.className ?? "").split(/\s+/).filter(Boolean).length;
  if (!wasProjected) return node;

  const style = Object.fromEntries(
    Object.entries(node.style ?? {}).filter(([key]) => !PROJECTION_STYLE_KEYS.has(key)),
  );
  const domAttributes = Object.fromEntries(
    Object.entries(node.domAttributes ?? {}).filter(([key]) => key !== "aria-hidden"),
  );

  return {
    ...node,
    className: classTokens.join(" ") || undefined,
    style: Object.keys(style).length > 0 ? style : undefined,
    domAttributes: Object.keys(domAttributes).length > 0 ? domAttributes : undefined,
    draggable: undefined,
    selectable: undefined,
    connectable: undefined,
    deletable: undefined,
    focusable: undefined,
  };
}

export const repairProjectedClusterNodes = (nodes: readonly Node[]): Node[] =>
  nodes.map(repairProjectedClusterNode);

/** Allows only React Flow deltas that cannot replace canonical node objects. */
export function filterCanonicalNodeChanges(
  changes: readonly NodeChange[],
  canonicalNodeIds: ReadonlySet<string>,
): NodeChange[] {
  return changes.filter((change) => {
    if (!("id" in change)) return false;
    if (!canonicalNodeIds.has(change.id)) return false;
    return change.type === "select" || change.type === "position" ||
      change.type === "dimensions" || change.type === "remove";
  });
}
