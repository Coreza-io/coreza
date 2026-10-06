interface DisplayNode {
  id: string;
  data: Record<string, unknown> & { definition?: { name?: unknown } };
}

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
export const getDisplayName = (node: DisplayNode, allNodes: readonly DisplayNode[]) => {
  const baseName = node.data.definition?.name;
  const sameType = allNodes.filter(
    (n) => n && n.data && n.data.definition?.name === baseName
  );
  const idx = sameType.findIndex((n) => n.id === node.id);
  const result = idx > 0 ? `${baseName}${idx}` : baseName;

  return result;
};
