import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../../src/index.css";
import { CompactClusterNode } from "../../../src/components/workflow/CompactClusterNode";
import { AuthProvider } from "../../../src/contexts/AuthContext";
import { UserPreferencesProvider } from "../../../src/contexts/UserPreferencesContext";
import {
  projectClusterGraph,
  getExpandedClusterFrameRect,
  resolveProjectedConnection,
} from "../../../src/domain/clusters/projection";
import { validateClusters } from "../../../src/domain/clusters/validate";
import {
  focusedClusterToViewState,
  closeFocusedCluster,
} from "../../../src/domain/clusters/viewState";
import { resolveClusterHierarchy } from "../../../src/domain/clusters/hierarchy";
import {
  capturePositions,
  translatePositions,
  applyPositionTargets,
} from "../../../src/domain/clusters/positions";
const outer = "11111111-1111-4111-8111-111111111111";
const inner = "22222222-2222-4222-8222-222222222222";
const clusters = [
  { id: outer, title: "Outer", memberNodeIds: ["c"] },
  {
    id: inner,
    title: "Inner",
    memberNodeIds: ["a", "b"],
    parentClusterId: outer,
  },
];
const initialNodes: Node[] = ["a", "b", "c"].map((id, i) => ({
  id,
  type: "member",
  position: { x: 100 + i * 330, y: 200 },
  data: {definition:{name:"Action",node_type:"main"}},
})).concat([
  {id:"d",type:"member",position:{x:850,y:550},data:{definition:{name:"Action",node_type:"main"}}},
  {id:"e",type:"member",position:{x:1200,y:550},data:{definition:{name:"Action",node_type:"main"}}},
]);
const initialEdges: Edge[] = [
  { id: "ab", source: "a", target: "b" },
  { id: "bc", source: "b", target: "c" },
];
declare global {
  interface Window {
    nestedMounts: Record<string, number>;
    nestedPositions: Record<string, { x: number; y: number }>;
    nestedEdges: Edge[];
  }
}
window.nestedMounts = {};
function Member({ id }: NodeProps): JSX.Element {
  useEffect(() => {
    window.nestedMounts[id] = (window.nestedMounts[id] ?? 0) + 1;
  }, [id]);
  return (
    <div
      data-member={id}
      className="h-[180px] w-[280px] rounded border bg-card p-4"
    >
      {id}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { member: Member, compactCluster: CompactClusterNode };
function Fixture(): JSX.Element {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [focus, setFocus] = useState<string | null>(null);
  const hierarchy = resolveClusterHierarchy(clusters);
  const view = focusedClusterToViewState(focus, clusters);
  const viewport = { x: 20, y: 20, zoom: 0.7 };
  const projection = useMemo(
    () =>
      projectClusterGraph(nodes, edges, clusters, view, setFocus, {
        focusedClusterId: focus,
        zoom: viewport.zoom,
      }),
    [nodes, edges, focus],
  );
  const drag = useRef<{
    start: { x: number; y: number };
    positions: ReturnType<typeof capturePositions>;
  } | null>(null);
  window.nestedPositions = Object.fromEntries(
    nodes.map((n) => [n.id, n.position]),
  );
  window.nestedEdges = edges;
  return (
    <main style={{ height: "100vh" }} className="bg-background text-foreground">
      <nav style={{ height: 48 }}>
        <button
          id="back"
          onClick={() => setFocus(closeFocusedCluster(focus, clusters))}
        >
          Back
        </button>
      </nav>
      <div style={{ position: "relative", height: "calc(100vh - 48px)" }}>
        <ReactFlow
          nodes={projection.nodes}
          edges={projection.edges}
          nodeTypes={nodeTypes}
          viewport={viewport}
          onConnect={connection => {
            const canonical = resolveProjectedConnection(connection,projection,nodes,edges);
            if (!canonical) return;
            const candidate = [...edges,{id:crypto.randomUUID(),...canonical}];
            if (validateClusters(nodes,candidate,clusters).valid) setEdges(candidate);
          }}
          onReconnect={(edge,connection) => {
            const canonical = resolveProjectedConnection(connection,projection,nodes,edges);
            if (!canonical) return;
            const candidate = edges.map(item => item.id === edge.id ? {...item,...canonical} : item);
            if (validateClusters(nodes,candidate,clusters).valid) setEdges(candidate);
          }}
        />
        <div className="pointer-events-none absolute inset-0">
          {clusters
            .filter((c) => view[c.id])
            .map((c) => {
              const rect = getExpandedClusterFrameRect(
                c,
                nodes,
                clusters,
                view,
                viewport.zoom,
              )!;
              return (
                <section
                  key={c.id}
                  data-frame={c.title}
                  className="absolute rounded-xl border-2 border-primary"
                  style={{
                    transform: `translate(${rect.x * viewport.zoom + viewport.x}px,${rect.y * viewport.zoom + viewport.y}px)`,
                    width: rect.width * viewport.zoom,
                    height: rect.height * viewport.zoom,
                  }}
                >
                  <header
                    data-drag={c.title}
                    className="pointer-events-auto flex h-[42px] items-center justify-between bg-card px-3"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = {
                        start: { x: event.clientX, y: event.clientY },
                        positions: capturePositions(
                          nodes,
                          hierarchy.effectiveMembers.get(c.id) ?? [],
                        ),
                      };
                    }}
                    onPointerMove={(event) => {
                      if (drag.current)
                        setNodes((current) =>
                          applyPositionTargets(
                            current,
                            translatePositions(drag.current!.positions, {
                              x:
                                (event.clientX - drag.current!.start.x) /
                                viewport.zoom,
                              y:
                                (event.clientY - drag.current!.start.y) /
                                viewport.zoom,
                            }),
                          ),
                        );
                    }}
                    onPointerUp={() => {
                      drag.current = null;
                    }}
                    onPointerCancel={() => {
                      if (drag.current)
                        setNodes((current) =>
                          applyPositionTargets(
                            current,
                            drag.current!.positions,
                          ),
                        );
                      drag.current = null;
                    }}
                  >
                    {c.title}
                    <button
                      data-close={c.title}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() =>
                        setFocus(closeFocusedCluster(c.id, clusters))
                      }
                    >
                      Close
                    </button>
                  </header>
                </section>
              );
            })}
        </div>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <UserPreferencesProvider>
      <ReactFlowProvider>
        <Fixture />
      </ReactFlowProvider>
    </UserPreferencesProvider>
  </AuthProvider>,
);
