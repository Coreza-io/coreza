import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Node } from "@xyflow/react";
import { projectClusterGraph } from "@/domain/clusters/projection";
import type { NodeCluster } from "@/domain/clusters/types";

const nodes: Node[] = [
  { id: "member", type: "runtime", position: { x: 0, y: 0 }, data: {} },
  { id: "outside", type: "runtime", position: { x: 300, y: 0 }, data: {} },
];
const cluster: NodeCluster = { id: "cluster", title: "Signals", memberNodeIds: ["member"] };

describe("collapsed cluster runtime hosts", () => {
  it("retains one listener across toggles and publishes one execution result", () => {
    const mounts = jest.fn();
    const unmounts = jest.fn();
    const publish = jest.fn();
    const executionListeners = new Set<(nodeId: string) => void>();

    function RuntimeNode({ id }: { id: string }) {
      useEffect(() => {
        if (id !== "member") return undefined;
        mounts();
        const execute = (nodeId: string) => {
          if (nodeId === id) publish({ nodeId: id, output: "complete" });
        };
        executionListeners.add(execute);
        return () => {
          executionListeners.delete(execute);
          unmounts();
        };
      }, [id]);
      return React.createElement("div", { "data-node-id": id });
    }

    const renderProjection = (expanded: boolean) => {
      const projection = projectClusterGraph(
        nodes,
        [],
        [cluster],
        expanded ? { [cluster.id]: true } : {},
        jest.fn(),
      );
      return React.createElement(
        React.Fragment,
        null,
        projection.nodes.map((node) => node.type === "compactCluster"
          ? React.createElement("div", { key: node.id, "data-compact-cluster": node.id })
          : React.createElement(RuntimeNode, { key: node.id, id: node.id })),
      );
    };

    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(renderProjection(true)); });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      act(() => renderer.update(renderProjection(false)));
      expect(renderer.root.findAllByProps({ "data-compact-cluster": "__coreza_cluster_display__:cluster" })).toHaveLength(1);
      act(() => renderer.update(renderProjection(true)));
    }

    expect(mounts).toHaveBeenCalledTimes(1);
    expect(unmounts).not.toHaveBeenCalled();

    act(() => executionListeners.forEach((listener) => listener("member")));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ nodeId: "member", output: "complete" });

    act(() => renderer.unmount());
    expect(unmounts).toHaveBeenCalledTimes(1);
  });
});
