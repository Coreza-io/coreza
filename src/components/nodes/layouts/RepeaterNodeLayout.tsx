import React, { Suspense, useCallback, useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, X, Plus } from "lucide-react";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import type { BaseNodeRenderProps } from "../BaseNode";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import { useReactFlow } from "@xyflow/react";

// ▶️ Helper to generate de-duplicated display names ("Alpaca", "Alpaca1", ...)
const getDisplayName = (node: any, allNodes: any[]) => {
  const baseName = node.data?.definition?.name || node.data?.config?.name || 'Node';
  const sameType = allNodes.filter(
    (n) => (n.data?.definition?.name || n.data?.config?.name) === baseName
  );
  const idx = sameType.findIndex((n) => n.id === node.id);
  return idx > 0 ? `${baseName}${idx}` : baseName;
};

interface RepeaterNodeLayoutProps extends BaseNodeRenderProps {
  nodes?: any[];
}

const RepeaterNodeLayout: React.FC<RepeaterNodeLayoutProps> = ({
  definition,
  fieldState,
  error,
  isSending,
  loadingSelect,
  selectOptions,
  showAuth,
  handleChange,
  handleSubmit,
  handleDrop,
  getFieldPreview,
  setShowAuth,
  fetchCredentials,
  referenceStyle,
  previousNodes,
  selectedPrevNodeId,
}) => {
  const { setNodes, setEdges, getNodes } = useReactFlow();

  // =========== DETERMINE REPEATER TYPE ===========
  const repeaterField = definition.fields?.find((f: any) => f.type === "repeater");
  const isConditional = repeaterField?.key === "conditions";
  const isSwitch = repeaterField?.key === "cases";

  // =========== CONDITIONAL LOGIC ===========
  const defaultCond = Array.isArray(repeaterField?.default) && repeaterField.default.length > 0
    ? repeaterField.default[0]
    : (repeaterField?.default ?? { left: "", operator: "===", right: "" });

  const initialConds = isConditional && fieldState.conditions && fieldState.conditions.length > 0
    ? fieldState.conditions
    : isConditional ? [defaultCond] : [];

  const initialOps = isConditional && fieldState.logicalOps && fieldState.logicalOps.length === initialConds.length - 1
    ? fieldState.logicalOps
    : isConditional ? Array(Math.max(0, initialConds.length - 1)).fill("AND") : [];

  // =========== SWITCH LOGIC ===========
  const defaultCase = isSwitch && Array.isArray(repeaterField?.default) && repeaterField.default.length > 0
    ? repeaterField.default
    : [{ caseValue: "case1", caseName: "Case 1" }];

  const initialCases = isSwitch && fieldState.cases && fieldState.cases.length > 0
    ? fieldState.cases
    : isSwitch ? defaultCase : [];

  // =========== STATE ===========
  const [conditions, setConditions] = useState(initialConds);
  const [logicalOps, setLogicalOps] = useState<string[]>(initialOps);
  const [cases, setCases] = useState(initialCases);
  const [sourceMap, setSourceMap] = useState<{ left?: string; right?: string }[]>(
    conditions.map(() => ({}))
  );

  // Debounced updates to prevent rapid-fire handleChange calls
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      console.log('🔄 RepeaterNodeLayout updating conditions/cases');
      if (isConditional) {
        handleChange("conditions", conditions);
        handleChange("logicalOps", logicalOps);
      }
      if (isSwitch) {
        handleChange("cases", cases);
      }
    }, 100); // 100ms debounce

    return () => clearTimeout(timeoutId);
  }, [conditions, logicalOps, cases, handleChange, isConditional, isSwitch]);

  // =========== CONDITIONAL HELPERS ===========
  const addCondition = () => {
    setConditions((c) => [...c, { ...defaultCond }]);
    setLogicalOps((lo) => [...lo, "AND"]);
    setSourceMap((sm) => (Array.isArray(sm) ? [...sm, {}] : [{}]));
  };

  const removeCondition = (idx: number) => {
    setConditions((c) => c.filter((_, i) => i !== idx));
    setLogicalOps((lo) => lo.filter((_, i) => i !== idx - 1));
    setSourceMap((sm) => sm.filter((_, i) => i !== idx));
  };

  const updateCondition = useCallback(
    (idx: number, field: string, value: string) => {
      setConditions((c) =>
        c.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
      );
    },
    []
  );

  const updateLogicalOp = useCallback((idx: number, op: string) => {
    setLogicalOps((lo) => lo.map((v, i) => (i === idx ? op : v)));
  }, []);

  // =========== SWITCH HELPERS ===========
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

  // =========== SHARED HELPERS ===========
  function resolveDeep(val, selectedInputData, allNodeData) {
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

  // Drag helper for repeater (conditional)
  const handleRepeaterDrop = useCallback(
    (
      idx: number,
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

        updateCondition(idx, field, currentValue + insert);

        setSourceMap((sm) => ({
          ...sm,
          [idx]: {
            ...(sm?.[idx] || {}),
            [field]: selectedPrevNodeId,
          },
        }));
      } catch (error) {
        console.error("Drop error:", error);
      }
      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [selectedPrevNodeId, updateCondition, previousNodes]
  );

  // Drag helper for switch
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
    (idx: number, field: "left" | "right", expr: any) => {
      if (typeof expr !== "string" && typeof expr !== "object") return null;
      if (typeof expr === "string" && !expr.includes("{{")) return null;

      const allNodes = getNodes();
      const srcId = sourceMap[idx]?.[field] || selectedPrevNodeId;
      const srcNode = allNodes.find((n) => n.id === srcId);

      if (!srcNode) {
        return "";
      }

      let srcData = srcNode.data?.output || srcNode.data?.input || srcNode.data?.values || {};
      if (Array.isArray(srcData) && srcData.length === 1) {
        srcData = srcData[0];
      }

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
    [selectedPrevNodeId, sourceMap, getNodes, previousNodes]
  );

  const getSwitchPreviewFor = useCallback(
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
            {definition?.def || definition?.name || 'Node'}
          </h2>
        </div>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit}>
        {/* Top-level fields (non-repeater) */}
        {(definition.fields || []).map((f: any) => {
          if (f.type === "repeater") return null;
          if (isSwitch && f.key === "defaultCase") return null; // Handle separately for switch
          
          // --------- CONDITIONAL FIELD DISPLAY ---------
          let shouldShow = true;
          if (f.displayOptions && f.displayOptions.show) {
            for (const [depKey, allowedValuesRaw] of Object.entries(f.displayOptions.show)) {
              const allowedValues = allowedValuesRaw as string[];
              if (!allowedValues.includes(fieldState[depKey])) {
                shouldShow = false;
                break;
              }
            }
          }
          if (!shouldShow) return null;
          // ---------------------------------------------

          return (
            <div key={f.key}>
              <Label>{f.label}</Label>

              {/* --------- Text Field --------- */}
              {f.type === "text" && (
                <div
                  className="nodrag"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    if (isSwitch) {
                      handleSwitchDrop(f.key, e, fieldState[f.key] || "");
                    } else {
                      handleDrop(
                        f.key,
                        (val: string) => handleChange(f.key, val),
                        e,
                        fieldState[f.key] || ""
                      );
                    }
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
                      Preview: {isSwitch ? getSwitchPreviewFor(fieldState[f.key]) : getFieldPreview(f.key)}
                    </div>
                  )}
                </div>
              )}

              {/* --------- Select (Credential) Field --------- */}
              {f.type === "select" && f.optionsSource === "credentialsApi" ? (
                <div className="flex gap-2 items-center">
                  <Select
                    value={fieldState[f.key]}
                    onValueChange={(val) => handleChange(f.key, val)}
                    disabled={loadingSelect[f.key]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          loadingSelect[f.key]
                            ? "Loading..."
                            : "Select credential"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectOptions[f.key] || []).length > 0 ? (
                        selectOptions[f.key].map((c: any) => (
                          <SelectItem key={c.name} value={c.name}>
                            {c.name || c.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-creds" disabled>
                          No credentials found
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    onClick={() => setShowAuth(true)}
                  >
                    Add
                  </Button>
                </div>
              ) : null}

              {/* --------- Regular Select Field --------- */}
              {f.type === "select" && f.optionsSource !== "credentialsApi" && (
                <Select
                  value={fieldState[f.key]}
                  onValueChange={(val) => handleChange(f.key, val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={f.placeholder || "Select option"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectOptions[f.key] || []).map((opt: any) => (
                      <SelectItem
                        key={opt.id || opt.value}
                        value={opt.id || opt.value}
                      >
                        {opt.name || opt.label || opt.id || opt.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}

        {/* --------- CONDITIONAL REPEATER (Conditions) --------- */}
        {isConditional && repeaterField && (
          <div className="space-y-3">
            <h4 className="font-semibold">Conditions</h4>

            {conditions.map((cond, i) => {
              const leftField = repeaterField.subFields?.find((sf: any) => sf.key === "left");
              const operatorField = repeaterField.subFields?.find((sf: any) => sf.key === "operator");
              const rightField = repeaterField.subFields?.find((sf: any) => sf.key === "right");

              return (
                <div key={i} className="space-y-2">
                  {i > 0 && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={logicalOps[i - 1]}
                        onValueChange={(v) => updateLogicalOp(i - 1, v)}
                      >
                        <SelectTrigger className="w-20 h-8 text-xs">
                          <SelectValue placeholder="Logic" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AND">AND</SelectItem>
                          <SelectItem value="OR">OR</SelectItem>
                        </SelectContent>
                      </Select>
                      <hr className="flex-1 border-t" />
                    </div>
                  )}

                  <div className="flex items-center gap-2 p-2 border rounded bg-muted/10">
                    {/* Left */}
                    {leftField && (leftField.options && leftField.options.length > 0) ? (
                      <Select
                        value={cond.left}
                        onValueChange={(v) => updateCondition(i, "left", v)}
                      >
                        <SelectTrigger className="flex-1 h-8 text-xs">
                          <SelectValue placeholder={leftField.placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {(leftField.options || []).map((opt: any) => (
                            <SelectItem key={opt.id || opt.value} value={opt.id || opt.value}>
                              {opt.name || opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                       <Input
                         className="flex-1 h-8 text-xs nodrag"
                         placeholder={leftField?.placeholder || "Left value"}
                         value={cond.left || ""}
                         onChange={(e) => updateCondition(i, "left", e.target.value)}
                         onDragOver={(e) => {
                           e.preventDefault();
                           e.stopPropagation();
                           e.dataTransfer.dropEffect = "copy";
                         }}
                         onDrop={(e) => handleRepeaterDrop(i, "left", e, cond.left || "")}
                         style={cond.left?.includes("{{") ? referenceStyle : undefined}
                         onFocus={(e) => e.target.select()}
                       />
                    )}

                    {/* Operator */}
                    {operatorField && (
                      <Select
                        value={cond.operator}
                        onValueChange={(v) => updateCondition(i, "operator", v)}
                      >
                        <SelectTrigger className="w-24 h-8 text-xs">
                          <SelectValue placeholder={operatorField.label} />
                        </SelectTrigger>
                        <SelectContent>
                          {(operatorField.options || []).map((opt: any) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                     {/* Right */}
                     {rightField && (
                       <Input
                         className="flex-1 h-8 text-xs nodrag"
                         placeholder={rightField.placeholder || "Right value"}
                         value={cond.right || ""}
                         onChange={(e) => updateCondition(i, "right", e.target.value)}
                         onDragOver={(e) => {
                           e.preventDefault();
                           e.stopPropagation();
                           e.dataTransfer.dropEffect = "copy";
                         }}
                         onDrop={(e) => handleRepeaterDrop(i, "right", e, cond.right || "")}
                         style={cond.right?.includes("{{") ? referenceStyle : undefined}
                         onFocus={(e) => e.target.select()}
                       />
                     )}

                    {conditions.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeCondition(i)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>

                  {/* Previews */}
                  {(cond.left?.includes("{{") || cond.right?.includes("{{")) && (
                    <div className="text-xs text-gray-500 space-y-1 ml-2">
                      {cond.left?.includes("{{") && (
                        <div>Left preview: {getPreviewFor(i, "left", cond.left)}</div>
                      )}
                      {cond.right?.includes("{{") && (
                        <div>Right preview: {getPreviewFor(i, "right", cond.right)}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addCondition}
              className="h-7 px-2"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Condition
            </Button>
          </div>
        )}

        {/* --------- SWITCH REPEATER (Cases) --------- */}
        {isSwitch && (
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
        )}

        {/* Default Case Field (Switch only) */}
        {isSwitch && definition.fields?.map((f: any) => {
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
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              "Execute"
            )}
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="text-red-500 text-xs mt-2 p-2 bg-red-50 rounded">
            {error}
          </div>
        )}
      </form>

      {/* Auth Modal */}
      <Suspense fallback={<div>Loading modal...</div>}>
        {showAuth && (
          <GenericAuthModal
            definition={definition}
            onClose={() => setShowAuth(false)}
          />
        )}
      </Suspense>
    </>
  );
};

export default RepeaterNodeLayout;