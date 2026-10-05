import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../../src/index.css";
import { ClusterExecutionControl } from "../../../src/components/workflow/ClusterExecutionControl";
import { CompactClusterNode } from "../../../src/components/workflow/CompactClusterNode";
import { projectClusterGraph } from "../../../src/domain/clusters/projection";
import type { NodeCluster } from "../../../src/domain/clusters/types";
import { AuthProvider } from "../../../src/contexts/AuthContext";
import { UserPreferencesProvider } from "../../../src/contexts/UserPreferencesContext";

declare global {
  interface Window { clusterMounts: Record<string, number>; }
}

window.clusterMounts = {};

const clusters: NodeCluster[] = ["Alpha", "Beta", "Gamma", "Delta"].map((title) => ({
  id: title.toLowerCase(),
  title: `${title} strategy`,
  memberNodeIds: [`${title.toLowerCase()}-loop`, `${title.toLowerCase()}-branch`],
}));
const initialCanonicalNodes: Node[] = [
  { id: "store", type: "member", position: { x: -100, y: 200 }, data: { label: "Outside Store" } },
  { id: "outside-overlap", type: "member", position: { x: 850, y: 220 }, data: { label: "Overlapping ordinary node" } },
  ...clusters.flatMap((cluster, index): Node[] => {
    const x = [300, 800, 1150, 1500][index];
    return [
      { id: cluster.memberNodeIds[0], type: "member", position: { x, y: 200 }, data: { label: `${cluster.title} Loop` } },
      { id: cluster.memberNodeIds[1], type: "member", position: { x: x + 270, y: 200 }, data: { label: `${cluster.title} Branch` } },
    ];
  }),
];
const canonicalEdges: Edge[] = clusters.flatMap((cluster) => [
  { id: `feed-${cluster.id}`, source: "store", target: cluster.memberNodeIds[0] },
  { id: `internal-${cluster.id}`, source: cluster.memberNodeIds[0], target: cluster.memberNodeIds[1] },
]).concat({ id: "visible-crossing", source: "store", target: "gamma-loop" });

function MemberNode({ id, data }: NodeProps<Node>): JSX.Element {
  useEffect(() => {
    window.clusterMounts[id] = (window.clusterMounts[id] ?? 0) + 1;
  }, [id]);
  return <div data-member-id={id} className="rounded border bg-card p-4 shadow">{String(data.label)}</div>;
}

const nodeTypes = { member: MemberNode, compactCluster: CompactClusterNode };

function Fixture(): JSX.Element {
  const [focusedClusterId, setFocusedClusterId] = useState<string | null>(null);
  const [canonicalNodes, setCanonicalNodes] = useState(initialCanonicalNodes);
  const [executions, setExecutions] = useState<Record<string, number>>({});
  const execute = useCallback((clusterId: string): void => setExecutions((current) => ({
    ...current,
    [clusterId]: (current[clusterId] ?? 0) + 1,
  })), []);
  const projection = useMemo(() => projectClusterGraph(
    canonicalNodes,
    canonicalEdges,
    clusters,
    {},
    setFocusedClusterId,
    {
      focusedClusterId,
      getRunState: () => ({ phase: "idle" }),
      onExecute: execute,
      onCancel: () => undefined,
    },
  ), [canonicalNodes, execute, focusedClusterId]);
  const focusedCluster = clusters.find(({ id }) => id === focusedClusterId);

  return <main className="h-screen bg-background text-foreground">
    <nav className="flex h-12 items-center gap-2 px-3">
      {clusters.map((cluster) => <button key={cluster.id} type="button" onClick={() => setFocusedClusterId(cluster.id)}>Focus {cluster.id}</button>)}
      <button type="button" onClick={() => setFocusedClusterId(null)}>Close focus</button>
      <button type="button" onClick={() => setCanonicalNodes((current) => current.map((node) => node.id === "outside-overlap" ? { ...node, position: { x: 1000, y: 500 } } : node))}>Move outsider away</button>
      {clusters.map((cluster) => <output key={cluster.id} data-executions={cluster.id}>{executions[cluster.id] ?? 0}</output>)}
    </nav>
    <div className="relative h-[calc(100vh-3rem)]">
      <ReactFlow nodes={projection.nodes} edges={projection.edges} nodeTypes={nodeTypes} fitView />
      {focusedCluster && <section data-focused-frame={focusedCluster.id} className="pointer-events-none absolute inset-8 rounded-xl border-2 border-primary">
        <header className="pointer-events-auto bg-card p-2 font-semibold">{focusedCluster.title}</header>
        <footer className="pointer-events-auto absolute inset-x-0 bottom-0 flex h-[52px] items-center justify-center bg-card/90 px-3">
          <div className="w-full max-w-sm"><ClusterExecutionControl presentation="labelled" title={focusedCluster.title} state={{ phase: "idle" }} onExecute={() => execute(focusedCluster.id)} onCancel={() => undefined} /></div>
        </footer>
      </section>}
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <AuthProvider><UserPreferencesProvider><ReactFlowProvider><Fixture /></ReactFlowProvider></UserPreferencesProvider></AuthProvider>,
);
