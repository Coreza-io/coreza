/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useMemo } from "react";
import { NodeProps } from "@xyflow/react";
import BaseNode from "@/components/nodes/BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "@/components/nodes/layout/BasicNodeLayout";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";
import { useStableNodes } from "@/contexts/StableNodeContext";

export interface LoopNodeData extends Record<string, any> {
  onAddNode: (parentId: string) => void;
}

export function LoopNode({ id, data, selected }: NodeProps) {
  const { getNodes, getEdges } = useStableNodes();
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
    if (IconComponent && typeof IconComponent === 'function') {
      return React.createElement(IconComponent, { className: "w-10 h-10" });
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
      {(renderProps) => {
        // Read nodes/edges imperatively for NodeWrapper - avoids re-render on drag
        const nodes = getNodes();
        const edges = getEdges();
        return (
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
              isTestListening: renderProps.isTestListening,
              onStopListening: renderProps.handleStopListening,
              isStreamPaused: renderProps.isStreamPaused,
              hasStreamCursor: renderProps.hasStreamCursor,
              canStepNext: renderProps.canStepNext,
              canStepPrevious: renderProps.canStepPrevious,
              onTogglePause: renderProps.handleTogglePause,
              onStepNext: renderProps.handleStepNext,
              onStepPrevious: renderProps.handleStepPrevious,
            }}
            icon={icon}
            label={renderProps.displayName}
            minWidth={definition.size?.width || 320}
            minHeight={definition.size?.height || 200}
            handles={definition.handles || []}
            nodeType={definition.node_type}
            category={definition.category}
            isEditing={renderProps.isEditing}
            editingName={renderProps.editingName}
            editInputRef={renderProps.editInputRef}
            startEditing={renderProps.startEditing}
            finishEditing={renderProps.finishEditing}
            setEditingName={renderProps.setEditingName}
            isExecuting={(data as any).isExecuting}
          >
            <BasicNodeLayout {...renderProps} />
          </NodeWrapper>
        </div>
        );
      }}
    </BaseNode>
  );
}

export default LoopNode;
