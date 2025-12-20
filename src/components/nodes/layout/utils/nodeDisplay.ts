import type { Node } from "@xyflow/react";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
export const getDisplayName = (node: Node<any>, allNodes: Node<any>[]) => {
  const baseName = node.data.definition?.name;
  const sameType = allNodes.filter(
    (n) => n && n.data && n.data.definition?.name === baseName
  );
  const idx = sameType.findIndex((n) => n.id === node.id);
  const result = idx > 0 ? `${baseName}${idx}` : baseName;

  return result;
};
