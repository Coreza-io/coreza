import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlow, ReactFlowProvider, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../../../src/index.css";
import { AuthProvider } from "../../../src/contexts/AuthContext";
import { ExecutionStoreProvider } from "../../../src/contexts/ExecutionStoreContext";
import { StableNodeProvider } from "../../../src/contexts/StableNodeContext";
import { UserPreferencesProvider } from "../../../src/contexts/UserPreferencesContext";
import { ExecutionControl } from "../../../src/components/workflow/ExecutionIconButton";
import NodeWrapper from "../../../src/utils/NodeWrapper";

type FixtureNode = Node<{ label: string; readOnly?: boolean }>;

const nodes: FixtureNode[] = [
  { id: "executable", type: "fixture", position: { x: 120, y: 100 }, data: { label: "Compute" } },
  { id: "read-only", type: "fixture", position: { x: 520, y: 100 }, data: { label: "History", readOnly: true } },
];

export function FixtureNode({ id, data, selected }: NodeProps<FixtureNode>): JSX.Element {
  const [executions, setExecutions] = useState(0);
  const execute = (): void => setExecutions((count) => count + 1);
  const collapsedControl = data.readOnly ? undefined : (
    <ExecutionControl targetKind="node" targetName={data.label} phase="idle" onExecute={execute} />
  );
  const expandedControl = data.readOnly ? undefined : (
    <ExecutionControl targetKind="node" targetName={data.label} phase="idle" presentation="labelled" onExecute={execute} />
  );

  return (
    <>
      <NodeWrapper
        nodeId={id}
        nodes={nodes}
        edges={[]}
        label={data.label}
        selected={selected}
        readOnly={data.readOnly}
        collapsedExecutionControl={collapsedControl}
      >
        <form><label>Value<input aria-label={`${data.label} value`} defaultValue="preserved" /></label>{expandedControl}</form>
      </NodeWrapper>
      <output data-execution-count={id}>{executions}</output>
    </>
  );
}

const nodeTypes = { fixture: FixtureNode };

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <UserPreferencesProvider>
      <ExecutionStoreProvider>
        <ReactFlowProvider>
          <StableNodeProvider>
            <main style={{ width: 1000, height: 600 }}>
              <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView />
            </main>
          </StableNodeProvider>
        </ReactFlowProvider>
      </ExecutionStoreProvider>
    </UserPreferencesProvider>
  </AuthProvider>,
);
