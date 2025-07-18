import React, { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { X, Plus } from "lucide-react";
import type { BaseNodeRenderProps } from "../BaseNode";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import { useReactFlow } from "@xyflow/react";

// Helper to generate de-duplicated display names ("Alpaca", "Alpaca1", ...)
const getDisplayName = (node: any, allNodes: any[]) => {
  const baseName = node.data?.definition?.name || node.data?.config?.name || 'Node';
  const sameType = allNodes.filter(
    (n) => (n.data?.definition?.name || n.data?.config?.name) === baseName
  );
  const idx = sameType.findIndex((n) => n.id === node.id);
  return idx > 0 ? `${baseName}${idx}` : baseName;
};

interface SwitchNodeLayoutProps extends BaseNodeRenderProps {
  nodes?: any[];
}

const SwitchNodeLayout: React.FC<SwitchNodeLayoutProps> = ({
  definition,
  fieldState,
  error,
  isSending,
  handleChange,
  handleSubmit,
  handleDrop,
  getFieldPreview,
  referenceStyle,
  previousNodes,
  selectedPrevNodeId,
}) => {
  const { getNodes } = useReactFlow();

  // =========== CASES/REPEATER LOGIC ===========
  const casesField = definition.fields?.find((f: any) => f.key === "cases");
  const defaultCase = Array.isArray(casesField?.default) && casesField.default.length > 0
    ? casesField.default
    : [{ caseValue: "case1", caseName: "Case 1" }];

  const initialCases = fieldState.cases && fieldState.cases.length > 0
    ? fieldState.cases
    : defaultCase;

  const [cases, setCases] = useState(initialCases);

  useEffect(() => {
    handleChange("cases", cases);
  }, [cases, handleChange]);

  // Case manipulation helpers
  const addCase = () => {
    const newIndex = cases.length + 1;
    setCases((c) => [...c, { caseValue: `case${newIndex}`, caseName: `Case ${newIndex}` }]);
  };

  const removeCase = (idx: number) => {
    setCases((c) => c.filter((_, i) => i !== idx));
  };

  const updateCase = useCallback(
    (idx: number, field: string, value: string) => {
      setCases((c) =>
        c.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
      );
    },
    []
  );

  // Helper for deep resolution
  function resolveDeep(val: any, selectedInputData: any, allNodeData: any) {
    if (typeof val === "string") {
      return resolveReferences(val, selectedInputData, allNodeData);
    }
    if (Array.isArray(val)) {
      return val.map(v => resolveDeep(v, selectedInputData, allNodeData));
    }
    if (typeof val === "object" && val !== null) {
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) =>
          [k, resolveDeep(v, selectedInputData, allNodeData)]
        )
      );
    }
    return val;
  }

  // Drag helper for switch input
  const handleSwitchDrop = useCallback(
    (
      field: string,
      e: React.DragEvent,
      currentValue: string
    ) => {
      e.preventDefault();
      e.stopPropagation();

      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) {
        document.body.classList.remove("cursor-grabbing", "select-none");
        return;
      }
      try {
        const { keyPath } = JSON.parse(raw);
        const sourceNode = previousNodes.find((n) => n.id === selectedPrevNodeId);
        const sourceDisplayName = sourceNode
          ? getDisplayName(sourceNode, previousNodes)
          : 'Node';
        const insert = `{{ $('${sourceDisplayName}').json.${keyPath} }}`;

        handleChange(field, currentValue + insert);
      } catch (error) {
        console.error("Drop error:", error);
      }
      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [selectedPrevNodeId, handleChange, previousNodes]
  );

  const getPreviewFor = useCallback(
    (expr: any) => {
      if (typeof expr !== "string" && typeof expr !== "object") return null;
      if (typeof expr === "string" && !expr.includes("{{")) return null;

      const allNodes = getNodes();
      const srcNode = allNodes.find((n) => n.id === selectedPrevNodeId);

      if (!srcNode) {
        return "";
      }

      let srcData = srcNode.data?.output || srcNode.data?.input || srcNode.data?.values || {};
      if (Array.isArray(srcData) && srcData.length === 1) {
        srcData = srcData[0];
      }

      // Build allNodeData
      const allNodeData = {};
      previousNodes.forEach(prevNode => {
        const displayName = getDisplayName(prevNode, allNodes);
        let nodeData = prevNode.data?.output || prevNode.data || {};
        if (Array.isArray(nodeData) && nodeData.length > 0) {
          nodeData = nodeData[0] || {};
        }
        allNodeData[displayName] = nodeData;
      });

      try {
        const resolved = resolveDeep(expr, srcData, allNodeData);
        return summarizePreview(resolved);
      } catch (error) {
        console.error("❌ Preview resolution error:", error);
        return "";
      }
    },
    [selectedPrevNodeId, getNodes, previousNodes]
  );

  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {definition?.icon && (
            <img src={definition.icon} alt="icon" className="w-6 h-6" />
          )}
          <h2 className="font-semibold text-base text-foreground flex-1">
            {definition?.def || definition?.name || 'Switch Node'}
          </h2>
        </div>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit}>
        {/* Input Value Field */}
        {definition.fields?.map((f: any) => {
          if (f.type === "repeater" || f.key === "defaultCase") return null;
          
          return (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <div
                className="nodrag"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  handleSwitchDrop(f.key, e, fieldState[f.key] || "");
                }}
              >
                <Input
                  value={fieldState[f.key] || ""}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className="nodrag"
                  style={fieldState[f.key]?.includes("{{") ? referenceStyle : undefined}
                  onFocus={(e) => e.target.select()}
                />
                {fieldState[f.key]?.includes("{{") && (
                  <div className="text-xs text-gray-500 mt-1">
                    Preview: {getPreviewFor(fieldState[f.key])}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Cases Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="font-semibold">Cases</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addCase}
              className="h-7 px-2"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Case
            </Button>
          </div>

          {cases.map((caseItem, i) => (
            <div key={i} className="flex items-center gap-2 p-2 border rounded bg-muted/10">
              <Input
                className="flex-1 h-8 text-xs nodrag"
                placeholder="case value (e.g., case1)"
                value={caseItem.caseValue || ""}
                onChange={(e) => updateCase(i, "caseValue", e.target.value)}
                onFocus={(e) => e.target.select()}
              />
              <Input
                className="flex-1 h-8 text-xs nodrag"
                placeholder="Case Label"
                value={caseItem.caseName || ""}
                onChange={(e) => updateCase(i, "caseName", e.target.value)}
                onFocus={(e) => e.target.select()}
              />
              {cases.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeCase(i)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Default Case Field */}
        {definition.fields?.map((f: any) => {
          if (f.key !== "defaultCase") return null;
          
          return (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <Input
                value={fieldState[f.key] || f.default || ""}
                onChange={(e) => handleChange(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="nodrag"
                onFocus={(e) => e.target.select()}
              />
            </div>
          );
        })}

        {/* Submit Button */}
        <div className="pt-2">
          <Button
            type="submit"
            size="sm"
            disabled={isSending}
            className="w-full"
          >
            {isSending ? "Executing..." : "Execute"}
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="text-red-500 text-xs mt-2 p-2 bg-red-50 rounded">
            {error}
          </div>
        )}
      </form>
    </>
  );
};

export default SwitchNodeLayout;