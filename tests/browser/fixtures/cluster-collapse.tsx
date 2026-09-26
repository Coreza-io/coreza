import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../../src/index.css";
import NodeWrapper from "../../../src/utils/NodeWrapper";
import { CompactClusterNode } from "../../../src/components/workflow/CompactClusterNode";
import { projectClusterGraph } from "../../../src/domain/clusters/projection";
import type { NodeCluster } from "../../../src/domain/clusters/types";
import { AuthProvider } from "../../../src/contexts/AuthContext";
import { UserPreferencesProvider } from "../../../src/contexts/UserPreferencesContext";

const canonicalNodes: Node[] = [
  { id: "backtest-init", type: "member", position: { x: 80, y: 100 }, data: { label: "BacktestInit" } },
  { id: "on-bar", type: "member", position: { x: 400, y: 100 }, data: { label: "OnBar" } },
  { id: "outside", type: "member", position: { x: 760, y: 100 }, data: { label: "Outside" } },
];
const canonicalEdges: Edge[] = [
  { id: "internal", source: "backtest-init", target: "on-bar" },
  { id: "boundary", source: "on-bar", target: "outside" },
];
const cluster: NodeCluster = {
  id: "strategy",
  title: "Strategy",
  memberNodeIds: ["backtest-init", "on-bar"],
};

export function MemberNode({ id, data, selected }: NodeProps<Node>): JSX.Element {
  return (
    <NodeWrapper nodeId={id} nodes={canonicalNodes} edges={canonicalEdges} label={String(data.label)} selected={selected} readOnly>
      <span>{String(data.label)}</span>
    </NodeWrapper>
  );
}

const nodeTypes = { member: MemberNode, compactCluster: CompactClusterNode };

export function Fixture(): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const projection = useMemo(
    () => projectClusterGraph(
      canonicalNodes,
      canonicalEdges,
      [cluster],
      expanded ? { [cluster.id]: true } : {},
      () => setExpanded(true),
    ),
    [expanded],
  );

  return (
    <main>
      <button id="collapse-cluster" type="button" onClick={() => setExpanded(false)}>Collapse cluster</button>
      <div style={{ width: 1100, height: 600 }}>
        <ReactFlow nodes={projection.nodes} edges={projection.edges} nodeTypes={nodeTypes} className="workflow-canvas" />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <UserPreferencesProvider>
      <ReactFlowProvider><Fixture /></ReactFlowProvider>
    </UserPreferencesProvider>
  </AuthProvider>,
);
