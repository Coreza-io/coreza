import type { Edge, Node } from "@xyflow/react";
import { applyClusterExecutionVisuals, applyNodeExecutionVisuals } from "@/domain/clusters/executionVisuals";

const nodes: Node[] = ["a", "b", "outside"].map((id) => ({
  id, position: { x: 0, y: 0 }, data: { definition: { node_type: "action" } },
}));
const edges: Edge[] = [
  { id: "internal", source: "a", target: "b", animated: false, className: "existing", style: { stroke: "blue", strokeWidth: 1 } },
  { id: "boundary", source: "a", target: "outside", animated: true },
  { id: "hidden", source: "b", target: "a", hidden: true },
];
const clusters = [{ id: "cluster", title: "Cluster", memberNodeIds: ["a", "b"] }];
const active = { sessionId: "session", clusterId: "cluster", nodeId: "a" };

it("highlights manual Play execution across visible incident connections and restores the base graph", () => {
  const result = applyNodeExecutionVisuals(nodes, edges, nodes, edges, "a");
  expect(result.nodes[0].data.isExecuting).toBe(true);
  expect(result.nodes[1]).toBe(nodes[1]);
  expect(result.edges[0].className).toBe("existing executing-edge");
  expect(result.edges[1]).toMatchObject({ animated: true, className: "executing-edge" });
  expect(result.edges[2]).toBe(edges[2]);
  const cleared = applyNodeExecutionVisuals(nodes, edges, nodes, edges, null);
  expect(cleared.nodes).toBe(nodes);
  expect(cleared.edges).toBe(edges);
});

it("copies only the active member and visible internal main connections, restoring exact base identities", () => {
  const result = applyClusterExecutionVisuals(nodes, edges, nodes, edges, clusters, active, true);
  expect(result.nodes[0].data.isExecuting).toBe(true);
  expect(result.nodes[1]).toBe(nodes[1]);
  expect(result.edges[0]).toMatchObject({ animated: true, className: "existing executing-edge", style: { strokeWidth: 3 } });
  expect(result.edges[1]).toBe(edges[1]);
  expect(result.edges[2]).toBe(edges[2]);
  expect(nodes[0].data.isExecuting).toBeUndefined();
  expect(edges[0].style?.stroke).toBe("blue");
  const cleared = applyClusterExecutionVisuals(nodes, edges, nodes, edges, clusters, null, true);
  expect(cleared.nodes).toBe(nodes);
  expect(cleared.edges).toBe(edges);
});

it("keeps collapsed runtime hosts non-interactive and excludes synthetic routes and attachments", () => {
  const hosts = [{ ...nodes[0], selectable: false, draggable: false, style: { opacity: 0 } }, nodes[1]];
  const collapsed = applyClusterExecutionVisuals(hosts, edges, nodes, edges, clusters, active, false);
  expect(collapsed.nodes[0]).toMatchObject({ selectable: false, draggable: false, style: { opacity: 0 }, data: { isExecuting: true } });
  expect(collapsed.edges).toBe(edges);
  const canonical = [{ ...nodes[0], data: { definition: { node_type: "action", handles: [{ id: "tool", type: "source", connectionKind: "attachment" }] } } }, nodes[1]];
  const attachment: Edge = { id: "tool", source: "a", sourceHandle: "tool", target: "b" };
  const routes = [{ ...edges[0], source: "synthetic" }, attachment];
  const result = applyClusterExecutionVisuals(nodes, routes, canonical, [...edges, attachment], clusters, active, true);
  expect(result.edges).toBe(routes);
  expect(applyClusterExecutionVisuals(nodes, edges, nodes, edges, clusters, { ...active, nodeId: "outside" }, true).nodes).toBe(nodes);
});
