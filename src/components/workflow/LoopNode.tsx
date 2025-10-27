import React, { useMemo } from "react";
import { NodeProps, useNodes, useEdges } from "@xyflow/react";
import BaseNode from "@/components/nodes/BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "@/components/nodes/layouts/BasicNodeLayout";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import { Plus } from "lucide-react";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";

export interface LoopNodeData extends Record<string, any> {
  onAddNode: (parentId: string) => void;
}

export function LoopNode({ id, data, selected }: NodeProps) {
  const nodes = useNodes();
  const edges = useEdges();
  const { onAddNode } = data as any;
  const definition = (data as any).definition || (data as any).config || {};
  const executionStore = useExecutionStore();

  const icon = useMemo(() => {
    if (!definition.icon) {
      return (
        <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
          <span className="text-xs">?</span>
        </div>
      );
    }
    const IconComponent =
      IconRegistry[definition.name as keyof typeof IconRegistry];
    if (IconComponent) {
      return <IconComponent className="w-10 h-10" />;
    }
    return (
      <CachedIcon
        src={definition.icon}
        alt="node icon"
        className="w-10 h-10"
        fallback={
          <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
            <span className="text-xs">{definition.name?.[0] || "?"}</span>
          </div>
        }
      />
    );
  }, [definition.icon, definition.name]);

  return (
    <BaseNode data={data} selected={selected ?? false}>
      {(renderProps) => (
        <div className="relative">
          <NodeWrapper
            nodeId={id}
            nodes={nodes}
            edges={edges}
            selected={selected}
            inputPanelProps={{
              handleDragStart: renderProps.handleDragStart,
              selectedPrevNodeId: renderProps.selectedPrevNodeId,
              setSelectedPrevNodeId: renderProps.setSelectedPrevNodeId,
              executionStore,
            }}
            outputPanelProps={{
              data: renderProps.displayedData,
              position: "right",
              pinned: renderProps.isPinned,
              onSave: renderProps.handlePanelSave,
              onPinToggle: renderProps.handlePanelPinToggle,
            }}
            icon={icon}
            label={renderProps.displayName}
            minWidth={definition.size?.width || 320}
            minHeight={definition.size?.height || 200}
            handles={definition.handles || []}
            nodeType={definition.node_type}
          >
            <BasicNodeLayout {...renderProps} />
          </NodeWrapper>
        </div>
      )}
    </BaseNode>
  );
}

export default LoopNode;
