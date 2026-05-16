/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { memo, useMemo, useState, useEffect, useRef, useCallback } from "react";
import BaseNode from "./BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "./layout/BasicNodeLayout";
import RepeaterNodeLayout from "./layout/RepeaterNodeLayout";
import { useNodeId, useReactFlow } from "@xyflow/react";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";
import { useStableNodes } from "@/contexts/StableNodeContext";

interface NodeRouterProps {
  data: any;
  selected: boolean;
}

// Tool handle used when node is toggled to tool mode
const TOOL_HANDLE = [{ type: "source" as const, position: "top" as const, id: "tool" }];
// Categories ineligible for tool toggle
const TOOL_INELIGIBLE_CATEGORIES = new Set([
  "Trigger", "Backtest", "AIAgent", "ChatModel", "LLM",
  "Stream", "Scheduler", "Input", "Visualization", "webhook",
]);

const NodeRouter: React.FC<NodeRouterProps> = ({ data, selected }) => {
  const nodeId = useNodeId();
  const { getNodes, getEdges } = useStableNodes();
  const { setNodes } = useReactFlow();
  const executionStore = useExecutionStore();

  const definition = data.definition;

  // Tool mode toggle: read from fieldState first, then persisted values
  const isTool = data.fieldState?.__isTool ?? data.values?.__isTool ?? false;

  // Guard: only allow tool toggle on eligible nodes (not triggers, backtest, AIAgent, etc.)
  const canToggleTool = definition.node_type === "main" &&
    !TOOL_INELIGIBLE_CATEGORIES.has(definition.category);

  const handleToggleTool = useCallback(() => {
    if (!nodeId) return;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                values: { ...((n.data as any).values || {}), __isTool: !isTool },
                fieldState: { ...((n.data as any).fieldState || {}), __isTool: !isTool },
              },
            }
          : n,
      ),
    );
  }, [nodeId, isTool, setNodes]);

  const fallbackEnabled = useMemo(() => {
    if (definition.name !== "Switch") return false;

    const explicitToggle =
      data.fieldState?.enableFallback ?? data.values?.enableFallback;
    if (typeof explicitToggle === "boolean") return explicitToggle;

    const definitionFallbackDefault = definition.fields?.find(
      (f: any) => f.key === "enableFallback"
    )?.default;
    if (typeof definitionFallbackDefault === "boolean") {
      return definitionFallbackDefault;
    }

    const legacyDefaultCase =
      data.fieldState?.defaultCase ?? data.values?.defaultCase;
    if (typeof legacyDefaultCase === "string") return true;

    return true;
  }, [
    data.fieldState?.defaultCase,
    data.fieldState?.enableFallback,
    data.values?.defaultCase,
    data.values?.enableFallback,
    definition.fields,
    definition.name,
  ]);

  const fallbackHandleId = useMemo(() => {
    if (definition.name !== "Switch") return "fallback";

    return (
      data.fieldState?.defaultCase || data.values?.defaultCase || "fallback"
    );
  }, [data.fieldState?.defaultCase, data.values?.defaultCase, definition.name]);

  // Determine layout type based on node characteristics
  const getLayoutType = (definition: any) => {
      // Check if node has repeater fields (conditional logic or switch cases)
    const hasRepeaterFields = definition.fields?.some(
      (f: any) => f.type === "repeater"
    );
    if (hasRepeaterFields) return "repeater";

    // Default to basic layout
    return "basic";
  };

  // return repeater or basic
  const layoutType = getLayoutType(definition);

  // Extract cases length for stable dependency tracking
  const casesLength = useMemo(() => {
    if (definition.name !== "Switch") return 0;

    const cases = data.fieldState?.cases || data.values?.cases;
    if (cases && cases.length > 0) {
      return cases.length;
    }

    // Use defaults from definition
    const casesField = definition.fields?.find((f: any) => f.key === "cases");
    const defaultCases = Array.isArray(casesField?.default)
      ? casesField?.default
      : casesField?.default
      ? [casesField.default]
      : [{ left: "", operator: "===", right: "", outputName: "Case 1" }];
    return defaultCases.length;
  }, [
    definition.name,
    definition.fields,
    data.fieldState?.cases,
    data.values?.cases,
  ]);

  // Memoize dynamic handles - swap to tool handle when isTool is active
  const dynamicHandles = useMemo(() => {
    // Tool mode: only expose the top "tool" source handle
    if (isTool) return TOOL_HANDLE;

    if (definition.name !== "Switch") {
      return definition.handles || [];
    }

    // For Switch nodes, generate handles based on cases - use stable reference
    const rawCases = data.fieldState?.cases || data.values?.cases;
    const cases = Array.isArray(rawCases) ? rawCases : [];

    // If no cases available, use defaults from definition
    if (cases.length === 0) {
      const casesField = definition.fields?.find((f: any) => f.key === "cases");
      const defaultCases = Array.isArray(casesField?.default)
        ? casesField?.default
        : casesField?.default
        ? [casesField.default]
        : [
            {
              left: "",
              operator: "===",
              right: "",
              outputName: "Case 1",
            },
          ];

      return [
        { type: "target", position: "left", id: "input" },
        ...defaultCases.map((caseItem: any, index: number) => ({
          type: "source",
          position: "right",
          id: caseItem.outputName || `case${index + 1}`,
        })),
        ...(fallbackEnabled
          ? [{ type: "source", position: "right", id: fallbackHandleId }]
          : []),
      ];
    }

    const handles = [{ type: "target", position: "left", id: "input" }];

    // Add handle for each case - ensure stable IDs
    cases.forEach((caseItem: any, index: number) => {
      const handleId =
        caseItem.outputName ||
        caseItem.caseName ||
        caseItem.caseValue ||
        `case${index + 1}`;
      console.log(`🔧 Adding Switch handle: ${handleId}`);
      handles.push({
        type: "source",
        position: "right",
        id: handleId,
      });
    });

    // Add default handle
    if (fallbackEnabled) {
      handles.push({
        type: "source",
        position: "right",
        id: fallbackHandleId,
      });
    }

    return handles;
  }, [
    isTool,
    definition.name,
    definition.handles,
    definition.fields,
    data.fieldState?.cases,
    data.values?.cases,
    fallbackEnabled,
    fallbackHandleId,
  ]);

  // Memoize dynamic size for Switch nodes to prevent infinite re-renders
  const dynamicSize = useMemo(() => {
    if (definition.name !== "Switch") {
      return {
        width: definition.size?.width || 340,
        height: definition.size?.height || 340,
      };
    }

    // For Switch nodes, calculate height based on number of cases - use stable reference
    const cases = data.fieldState?.cases || data.values?.cases;
    let caseCount = 1; // Default case count

    if (cases && cases.length > 0) {
      caseCount = cases.length;
    } else {
      // Use defaults from definition
      const casesField = definition.fields?.find((f: any) => f.key === "cases");
      const defaultCases = Array.isArray(casesField?.default)
        ? casesField?.default
        : casesField?.default
        ? [casesField.default]
        : [
            {
              left: "",
              operator: "===",
              right: "",
              outputName: "Case 1",
            },
          ];
      caseCount = defaultCases.length;
    }

    // Base height + extra height per case (including default case)
    const baseHeight = 340;
    const heightPerCase = 40;
    const totalCases = caseCount + (fallbackEnabled ? 1 : 0);
    const dynamicHeight = Math.max(
      baseHeight,
      baseHeight + (totalCases - 2) * heightPerCase
    );

    return {
      width: definition.size?.width || 340,
      height: dynamicHeight,
    };
  }, [
    definition.name,
    definition.size?.width,
    definition.size?.height,
    definition.fields,
    data.fieldState?.cases,
    data.values?.cases,
    fallbackEnabled,
  ]);

  if (!data) {
    console.error("NodeRouter: data prop is undefined for node", nodeId);
    return (
      <div className="min-w-[180px] shadow-node border-node bg-card rounded-lg p-3">
        <span className="text-sm text-muted-foreground">No data provided</span>
      </div>
    );
  }

  if (!definition) {
    console.error("NodeRouter: no definition found for node", nodeId, data);
    return (
      <div className="min-w-[180px] shadow-node border-node bg-card rounded-lg p-3">
        <span className="text-sm text-muted-foreground">
          No definition found
        </span>
      </div>
    );
  }

  return (
    <BaseNode data={data} selected={selected} readOnly={data.readOnly}>
      {(renderProps) => {
        // Read nodes/edges imperatively for NodeWrapper - avoids re-render on drag
        const nodes = getNodes();
        const edges = getEdges();
        return (
        <NodeWrapper
          nodeId={nodeId}
          nodes={nodes}
          edges={edges}
          selected={selected}
          readOnly={data.readOnly}
          executionStatus={data.executionStatus}
          executionDuration={data.executionDuration}
          itemCount={data.itemCount}
          inputPanelProps={{
            handleDragStart: renderProps.handleDragStart,
            selectedPrevNodeId: renderProps.selectedPrevNodeId,
            setSelectedPrevNodeId: renderProps.setSelectedPrevNodeId,
            executionStore,
            executionInput: data.executionInput,
            allNodeExecutions: data.allNodeExecutions,
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
          icon={(() => {
            if (!definition.icon) {
              return (
                <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                  <span className="text-xs">?</span>
                </div>
              );
            }

            // Use inline SVG components for instant rendering
            const IconComponent =
              IconRegistry[definition.name as keyof typeof IconRegistry];
            if (IconComponent && typeof IconComponent === 'function') {
              return React.createElement(IconComponent, { className: "w-10 h-10" });
            }

            // Fallback to cached image for other icons
            return (
              <CachedIcon
                src={definition.icon}
                alt="node icon"
                className="w-10 h-10"
                fallback={
                  <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                    <span className="text-xs">
                      {definition.name?.[0] || "?"}
                    </span>
                  </div>
                }
              />
            );
          })()}
          label={renderProps.displayName}
          minWidth={dynamicSize.width}
          minHeight={dynamicSize.height}
          handles={dynamicHandles}
          nodeType={definition.node_type}
          category={definition.category}
          electricBorder={true}
          electricColor="cyan"
          isStreamingWaiting={data.isStreamingWaiting}
          streamDataReceived={data.streamDataReceived}
          // Node name editing props
          isEditing={renderProps.isEditing}
          editingName={renderProps.editingName}
          editInputRef={renderProps.editInputRef}
          startEditing={renderProps.startEditing}
          finishEditing={renderProps.finishEditing}
          setEditingName={renderProps.setEditingName}
          isExecuting={data.isExecuting}
          isTool={isTool}
          onToggleTool={canToggleTool ? handleToggleTool : undefined}
        >
          {layoutType === "repeater" ? (
            <RepeaterNodeLayout {...renderProps} />
          ) : (
            <BasicNodeLayout {...renderProps} />
          )}
        </NodeWrapper>
        );
      }}
    </BaseNode>
  );
};

// Memoize the entire component to prevent unnecessary re-renders
export default memo(NodeRouter);
