import type { Node } from "@xyflow/react";

export { buildBranchOrders, findLinearBranchGroups, orderedReadyIndex, readBranchOrder } from "../../coreza-backend/src/engine/branchOrder";

export function branchOrderNodes(nodes: readonly Node[]) {
  return nodes.map(({ id, data }) => {
    const definition = data.definition as { name?: string; node_type?: string } | undefined;
    const values = data.values as { __isTool?: unknown; checkDependency?: unknown } | undefined;
    return {
      id,
      name: definition?.name,
      node_type: values?.__isTool === true ? "sub" : definition?.node_type,
      values,
    };
  });
}
