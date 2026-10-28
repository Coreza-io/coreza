type WorkflowNode = {
  values?: { mode?: string };
  data?: {
    values?: { mode?: string };
    config?: { mode?: string };
    mode?: string;
  };
  type?: string;
  name?: string;
  def?: string;
  node_type?: string;
};

type WorkflowLike = {
  nodes?: unknown;
};

const getNodeMode = (node: WorkflowNode): string | undefined =>
  node.values?.mode ??
  node.data?.values?.mode ??
  node.data?.config?.mode ??
  node.data?.mode;

const isPortfolioNode = (node: WorkflowNode): boolean => {
  const nodeName = `${node.type ?? node.name ?? node.def ?? node.node_type ?? ""}`.toLowerCase();
  return nodeName === "portfolio";
};

export const isBrokerPortfolioWorkflow = (workflow: WorkflowLike): boolean => {
  const nodes = Array.isArray(workflow.nodes) ? (workflow.nodes as WorkflowNode[]) : [];
  return nodes.some((node) => isPortfolioNode(node) && getNodeMode(node) === "broker");
};

