import React, { memo } from "react";
import BaseNode from "./BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "./layouts/BasicNodeLayout";
import ConditionalNodeLayout from "./layouts/ConditionalNodeLayout";
import { useNodeId, useNodes, useEdges } from "@xyflow/react";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Trash2 } from 'lucide-react';

interface NodeRouterProps {
  data: any;
  selected: boolean;
  onDeleteNode?: (nodeId: string) => void;
}

const NodeRouter: React.FC<NodeRouterProps> = ({ data, selected, onDeleteNode }) => {
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

  const handleDeleteClick = () => {
    if (onDeleteNode && nodeId) {
      onDeleteNode(nodeId);
    }
  };

  const NodeContent = () => (
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
          {layoutType === "conditional" ? (
            <ConditionalNodeLayout {...renderProps} />
          ) : (
            <BasicNodeLayout {...renderProps} />
          )}
        </NodeWrapper>
      )}
    </BaseNode>
  );

  // Handle right-click directly without ContextMenu wrapper
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    console.log('NodeRouter: Right click detected on node', nodeId);
    
    // Create a simple custom context menu
    const contextMenu = document.createElement('div');
    contextMenu.className = 'fixed z-50 bg-card border border-border rounded-md shadow-md p-1';
    contextMenu.style.left = `${e.clientX}px`;
    contextMenu.style.top = `${e.clientY}px`;
    
    const deleteButton = document.createElement('button');
    deleteButton.className = 'flex items-center w-full px-3 py-2 text-sm text-destructive hover:bg-muted rounded';
    deleteButton.innerHTML = `
      <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
      </svg>
      Delete Node
    `;
    
    deleteButton.onclick = () => {
      if (onDeleteNode && nodeId) {
        onDeleteNode(nodeId);
      }
      document.body.removeChild(contextMenu);
    };
    
    contextMenu.appendChild(deleteButton);
    document.body.appendChild(contextMenu);
    
    // Remove context menu when clicking elsewhere
    const removeMenu = (event: MouseEvent) => {
      if (!contextMenu.contains(event.target as Node)) {
        if (document.body.contains(contextMenu)) {
          document.body.removeChild(contextMenu);
        }
        document.removeEventListener('click', removeMenu);
      }
    };
    
    setTimeout(() => {
      document.addEventListener('click', removeMenu);
    }, 0);
  };

  // Add debugging for double-click events
  const handleDoubleClick = (e: React.MouseEvent) => {
    console.log('NodeRouter: Double click detected on node', nodeId);
    // Don't prevent default or stop propagation - let it bubble up to ReactFlow
  };

  return (
    <div 
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <NodeContent />
    </div>
  );
};

// Memoize the entire component to prevent unnecessary re-renders
export default memo(NodeRouter);