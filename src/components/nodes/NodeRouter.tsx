import React, { memo } from "react";
import BaseNode from "./BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "./layouts/BasicNodeLayout";
import ConditionalNodeLayout from "./layouts/ConditionalNodeLayout";
import SwitchNodeLayout from "./layouts/SwitchNodeLayout";
import { useNodeId, useNodes, useEdges } from "@xyflow/react";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";

interface NodeRouterProps {
  data: any;
  selected: boolean;
}

const NodeRouter: React.FC<NodeRouterProps> = ({ data, selected }) => {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const edges = useEdges();
  
  // Add safety check for data
  if (!data) {
    console.error("NodeRouter: data prop is undefined for node", nodeId);
    return (
      <div className="min-w-[180px] shadow-node border-node bg-card rounded-lg p-3">
        <span className="text-sm text-muted-foreground">No data provided</span>
      </div>
    );
  }
  
  const definition = data.definition || data.config;

  if (!definition) {
    console.error("NodeRouter: no definition found for node", nodeId, data);
    return (
      <div className="min-w-[180px] shadow-node border-node bg-card rounded-lg p-3">
        <span className="text-sm text-muted-foreground">No definition found</span>
      </div>
    );
  }

  // Determine layout type based on node characteristics
  const getLayoutType = (definition: any) => {
    // Switch nodes get their own special layout
    if (definition.name === "Switch") return "switch";
    
    // Check if node has repeater fields (conditional logic)
    const hasRepeaterFields = definition.fields?.some((f: any) => f.type === "repeater");
    if (hasRepeaterFields) return "conditional";
    
    // Check for specific conditional node types
    const conditionalNodeTypes = ["If", "Filter"];
    if (conditionalNodeTypes.includes(definition.name)) return "conditional";
    
    // Default to basic layout
    return "basic";
  };

  const layoutType = getLayoutType(definition);

  return (
    <BaseNode data={data} selected={selected}>
      {(renderProps) => (
        <NodeWrapper
          nodeId={nodeId}
          nodes={nodes}
          edges={edges}
          selected={selected}
          inputPanelProps={{
            handleDragStart: renderProps.handleDragStart,
            selectedPrevNodeId: renderProps.selectedPrevNodeId,
            setSelectedPrevNodeId: renderProps.setSelectedPrevNodeId,
          }}
          outputPanelProps={{
            data: renderProps.displayedData,
            position: "right",
            pinned: renderProps.isPinned,
            onSave: renderProps.handlePanelSave,
            onPinToggle: renderProps.handlePanelPinToggle,
          }}
          icon={(() => {
            if (!definition.icon) {
              return (
                <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                  <span className="text-xs">?</span>
                </div>
              );
            }

            // Use inline SVG components for instant rendering
            const IconComponent = IconRegistry[definition.name as keyof typeof IconRegistry];
            if (IconComponent) {
              return <IconComponent className="w-10 h-10" />;
            }

            // Fallback to cached image for other icons
            return (
              <CachedIcon
                src={definition.icon}
                alt="node icon"
                className="w-10 h-10"
                fallback={
                  <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                    <span className="text-xs">{definition.name?.[0] || '?'}</span>
                  </div>
                }
              />
            );
          })()}
          label={renderProps.displayName}
          minWidth={definition.size?.width || 340}
          minHeight={definition.size?.height || 340}
          handles={definition.handles || []}
          nodeType={definition.node_type}
        >
          {layoutType === "switch" ? (
            <SwitchNodeLayout {...renderProps} />
          ) : layoutType === "conditional" ? (
            <ConditionalNodeLayout {...renderProps} />
          ) : (
            <BasicNodeLayout {...renderProps} />
          )}
        </NodeWrapper>
      )}
    </BaseNode>
  );
};

// Memoize the entire component to prevent unnecessary re-renders
export default memo(NodeRouter);