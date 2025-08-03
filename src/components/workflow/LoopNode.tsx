import React from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import "@xyflow/react/dist/style.css";
import BaseNode from "@/components/nodes/BaseNode";

export interface LoopNodeData {
  onAddNode: (parentId: string) => void;
  label?: string;
  [key: string]: any;
}

export function LoopNode({ id, data, selected }: NodeProps<LoopNodeData>) {
  const { onAddNode, label } = data;

  return (
    <BaseNode data={data} selected={selected ?? false}>
      {({ handleSubmit }) => (
        <div
          style={{
            position: "relative",
            padding: 10,
            border: "2px solid #22c55e",
            borderRadius: 8,
            background: "white",
            minWidth: 120,
            textAlign: "center",
          }}
          className="loop-node"
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit();
          }}
        >
          <div style={{ fontSize: 24, color: "#22c55e" }}>↻</div>
          <div>{label || "Loop Over Items"}</div>
          <Handle
            type="target"
            position={Position.Left}
            id="in"
            style={{ background: "#555" }}
          />
          <Handle
            type="source"
            position={Position.Top}
            id="done"
            style={{ top: -4, background: "#555" }}
          />
          <div
            onClick={() => onAddNode(id)}
            style={{
              position: "absolute",
              top: -12,
              right: -12,
              width: 24,
              height: 24,
              borderRadius: 12,
              background: "#fff",
              border: "2px solid #22c55e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
            title="Add node to loop"
          >
            <Plus color="#22c55e" size={12} />
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="loop"
            style={{ top: "60%", background: "#22c55e" }}
          />
        </div>
      )}
    </BaseNode>
  );
}
