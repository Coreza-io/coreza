import React, { memo } from "react";
import BaseNode from "./BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "./layouts/BasicNodeLayout";
import RepeaterNodeLayout from "./layouts/RepeaterNodeLayout";
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
    // Check if node has repeater fields (conditional logic or switch cases)
    const hasRepeaterFields = definition.fields?.some((f: any) => f.type === "repeater");
    if (hasRepeaterFields) return "repeater";
    
    // Check for specific conditional/switch node types (backwards compatibility)
    const repeaterNodeTypes = ["If", "Switch", "Filter"];
    if (repeaterNodeTypes.includes(definition.name)) return "repeater";
    
    // Default to basic layout
    return "basic";
  };

  const layoutType = getLayoutType(definition);

  // Generate dynamic handles for Switch nodes
  const getDynamicHandles = (definition: any, data: any) => {
    if (definition.name !== "Switch") {
      return definition.handles || [];
    }

    // For Switch nodes, generate handles based on cases
    const fieldState = data.fieldState || {};
    const cases = fieldState.cases || definition.fields?.find(f => f.key === "cases")?.default || [];
    
    const handles = [
      { type: "target", position: "left", id: "input" }
    ];
    
    // Add handle for each case
    cases.forEach((caseItem: any, index: number) => {
      handles.push({
        type: "source",
        position: "right",
        id: caseItem.caseValue || `case${index + 1}`
      });
    });
    
    // Add default handle
    handles.push({
      type: "source",
      position: "right", 
      id: fieldState.defaultCase || "default"
    });
    
    return handles;
  };

  const dynamicHandles = getDynamicHandles(definition, data);

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
          handles={dynamicHandles}
          nodeType={definition.node_type}
        >
          {layoutType === "repeater" ? (
            <RepeaterNodeLayout {...renderProps} />
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