import React from "react";
import BaseNode from "./BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "./layouts/BasicNodeLayout";
import ConditionalNodeLayout from "./layouts/ConditionalNodeLayout";
import { useNodeId, useNodes, useEdges } from "@xyflow/react";

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
    // Check if node has repeater fields (conditional logic)
    const hasRepeaterFields = definition.fields?.some((f: any) => f.type === "repeater");
    if (hasRepeaterFields) return "conditional";
    
    // Check for specific conditional node types
    const conditionalNodeTypes = ["If", "Switch", "Filter"];
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
          icon={
            definition.icon ? (
              definition.icon.startsWith('/assets/') ? (
                <img 
                  src={definition.icon} 
                  className="w-10 h-10" 
                  alt="node icon"
                  loading="eager"
                  style={{ imageRendering: 'auto' }}
                  onError={(e) => {
                    console.warn(`Failed to load icon: ${definition.icon}`);
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <img 
                  src={definition.icon} 
                  className="w-10 h-10" 
                  alt="node icon"
                  loading="eager"
                />
              )
            ) : (
              // Fallback icon if no icon is defined
              <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                <span className="text-xs">?</span>
              </div>
            )
          }
          label={renderProps.displayName}
          minWidth={definition.size?.width || 340}
          minHeight={definition.size?.height || 340}
          handles={definition.handles || []}
          nodeType={definition.node_type}
        >
          {layoutType === "conditional" ? (
            <ConditionalNodeLayout {...renderProps} />
          ) : (
            <BasicNodeLayout {...renderProps} />
          )}
        </NodeWrapper>
      )}
    </BaseNode>
  );
};

export default NodeRouter;