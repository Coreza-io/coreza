import React, { memo, useMemo } from "react";
import BaseNode from "./BaseNode";
import NodeWrapper from "@/utils/NodeWrapper";
import BasicNodeLayout from "./layouts/BasicNodeLayout";
import RepeaterNodeLayout from "./layouts/RepeaterNodeLayout";
import { useNodeId, useNodes, useEdges } from "@xyflow/react";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";

interface NodeRouterProps {
  data: any;
  selected: boolean;
}

const NodeRouter: React.FC<NodeRouterProps> = ({ data, selected }) => {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const edges = useEdges();
  const executionStore = useExecutionStore();

  const definition = data.definition;

  // Determine layout type based on node characteristics
  const getLayoutType = (definition: any) => {
    // Check if node has repeater fields (conditional logic or switch cases)
    const hasRepeaterFields = definition.fields?.some(
      (f: any) => f.type === "repeater"
    );
    if (hasRepeaterFields) return "repeater";

    // Check for specific conditional/switch node types (backwards compatibility)
    const repeaterNodeTypes = ["If", "Switch", "Filter"];
    if (repeaterNodeTypes.includes(definition.name)) return "repeater";

    // Default to basic layout
    return "basic";
  };

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
    const defaultCases = casesField?.default || [
      { caseValue: "case1", caseName: "Case 1" },
    ];
    return defaultCases.length;
  }, [
    definition.name,
    definition.fields,
    data.fieldState?.cases,
    data.values?.cases,
  ]);

  // Memoize dynamic handles for Switch nodes to prevent infinite re-renders
  const dynamicHandles = useMemo(() => {
    if (definition.name !== "Switch") {
      return definition.handles || [];
    }

    // For Switch nodes, generate handles based on cases - use stable reference
    const cases = data.fieldState?.cases || data.values?.cases;

    // If no cases available, use defaults from definition
    if (!cases || cases.length === 0) {
      const casesField = definition.fields?.find((f: any) => f.key === "cases");
      const defaultCases = casesField?.default || [
        { caseValue: "case1", caseName: "Case 1" },
      ];

      return [
        { type: "target", position: "left", id: "input" },
        ...defaultCases.map((caseItem: any, index: number) => ({
          type: "source",
          position: "right",
          id: caseItem.caseValue || `case${index + 1}`,
        })),
        { type: "source", position: "right", id: "default" },
      ];
    }

    const handles = [{ type: "target", position: "left", id: "input" }];

    // Add handle for each case - ensure stable IDs
    cases.forEach((caseItem: any, index: number) => {
      const handleId = caseItem.caseValue || `case${index + 1}`;
      console.log(`🔧 Adding Switch handle: ${handleId}`);
      handles.push({
        type: "source",
        position: "right",
        id: handleId,
      });
    });

    // Add default handle
    handles.push({
      type: "source",
      position: "right",
      id: data.fieldState?.defaultCase || data.values?.defaultCase || "default",
    });

    return handles;
  }, [definition.name, definition.handles, definition.fields, casesLength]);

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
      const defaultCases = casesField?.default || [
        { caseValue: "case1", caseName: "Case 1" },
      ];
      caseCount = defaultCases.length;
    }

    // Base height + extra height per case (including default case)
    const baseHeight = 340;
    const heightPerCase = 40;
    const totalCases = caseCount + 1; // +1 for default case
    const dynamicHeight = Math.max(
      baseHeight,
      baseHeight + (totalCases - 2) * heightPerCase
    );

    return {
      width: definition.size?.width || 340,
      height: dynamicHeight,
    };
  }, [definition.name, definition.size, definition.fields, casesLength]);

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
            executionStore,
          }}
          outputPanelProps={{
            nodeId: nodeId,
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
            const IconComponent =
              IconRegistry[definition.name as keyof typeof IconRegistry];
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
          // Node name editing props
          isEditing={renderProps.isEditing}
          editingName={renderProps.editingName}
          editInputRef={renderProps.editInputRef}
          startEditing={renderProps.startEditing}
          finishEditing={renderProps.finishEditing}
          setEditingName={renderProps.setEditingName}
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
