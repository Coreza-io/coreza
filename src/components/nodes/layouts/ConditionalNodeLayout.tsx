import React, { Suspense, useCallback, useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, X } from "lucide-react";
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

interface ConditionalNodeLayoutProps extends BaseNodeRenderProps {
  nodes?: any[];
}

const ConditionalNodeLayout: React.FC<ConditionalNodeLayoutProps> = ({
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

  // =========== CONDITIONS/REPEATER LOGIC ===========
  const condField = definition.fields?.find((f: any) => f.key === "conditions");
  const defaultCond = Array.isArray(condField?.default) && condField.default.length > 0
    ? condField.default[0]
    : (condField?.default ?? { left: "", operator: "===", right: "" });

  const initialConds = fieldState.conditions && fieldState.conditions.length > 0
    ? fieldState.conditions
    : [defaultCond];

  const initialOps = fieldState.logicalOps && fieldState.logicalOps.length === initialConds.length - 1
    ? fieldState.logicalOps
    : Array(initialConds.length - 1).fill("AND");

  const [conditions, setConditions] = useState(initialConds);
  const [logicalOps, setLogicalOps] = useState<string[]>(initialOps);
  const [sourceMap, setSourceMap] = useState<{ left?: string; right?: string }[]>(
    conditions.map(() => ({}))
  );

  useEffect(() => {
    handleChange("conditions", conditions);
    handleChange("logicalOps", logicalOps);
  }, [conditions, logicalOps, handleChange]);

  // List-manipulation helpers
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

  // Drag helper for repeater
  const handleRepeaterDrop = useCallback(
    (
      idx: number,
      field: string,
      e: React.DragEvent,
      currentValue: string
    ) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Drop fired!", { idx, field, e, currentValue });
      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) {
        document.body.classList.remove("cursor-grabbing", "select-none");
        return;
      }
      try {
        const { keyPath } = JSON.parse(raw);
        // ▶️ INJECT SOURCE NODE'S UNIQUE DISPLAY NAME FOR DRAG-AND-DROP
        // locate the node where the drag originated
        const sourceNode = previousNodes.find((n) => n.id === selectedPrevNodeId);
        const sourceDisplayName = sourceNode
          ? getDisplayName(sourceNode, previousNodes)
          : 'Node';
        const insert = `{{ $('${sourceDisplayName}').json.${keyPath} }}`;
        updateCondition(idx, field, currentValue + insert);
        setSourceMap((sm) => {
          const arr = Array.isArray(sm) ? sm : [];
          const copy = [...arr];
          copy[idx] = { ...(copy[idx] ?? {}), [field]: selectedPrevNodeId };
          return copy;
        });
      } catch (error) {
        console.error("Drop error:", error);
      }
      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [selectedPrevNodeId, updateCondition, previousNodes]
  );

  const getPreviewFor = useCallback(
    (idx: number, field: "left" | "right", expr: string) => {
      if (typeof expr !== "string" || !expr.includes("{{")) return null;
      
      // Get fresh node data from React Flow
      const allNodes = getNodes();
      const srcId = sourceMap[idx]?.[field] || selectedPrevNodeId;
      const srcNode = allNodes.find((n) => n.id === srcId);
      
      if (!srcNode) {
        console.log("🔍 Preview Debug - No source node found:", { srcId, allNodes: allNodes.length });
        return "";
      }
      
      // Use output data if available, otherwise use input data, otherwise use node values
      let srcData = srcNode.data?.output || srcNode.data?.input || srcNode.data?.values || {};
      
      // If srcData is an array with one element, use that element (common case for API responses)
      if (Array.isArray(srcData) && srcData.length === 1) {
        srcData = srcData[0];
      }
      
      console.log("🔍 Preview Debug:", {
        idx,
        field,
        expr,
        srcId,
        srcNode: srcNode.data,
        srcData,
        originalData: srcNode.data?.output || srcNode.data?.input || srcNode.data?.values,
        sourceMap: sourceMap[idx],
        hasOutput: !!srcNode.data?.output,
        hasInput: !!srcNode.data?.input,
        hasValues: !!srcNode.data?.values
      });
      
      try {
        const resolved = resolveReferences(expr, srcData);
        console.log("✅ Resolved preview:", { expr, srcData, resolved });
        return summarizePreview(resolved);
      } catch (error) {
        console.error("❌ Preview resolution error:", error);
        return "";
      }
    },
    [selectedPrevNodeId, sourceMap, getNodes]
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
                    handleDrop(
                      f.key,
                      (val: string) => handleChange(f.key, val),
                      e,
                      fieldState[f.key] || ""
                    );
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
                      Preview: {getFieldPreview(f.key)}
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

        {/* --------- Repeater Field (Conditions) --------- */}
        {condField && (
          <div className="space-y-3">
            <h4 className="font-semibold">Conditions</h4>

            {conditions.map((cond, i) => {
              // Pull out the three main subFields
              const leftField = condField.subFields?.find((sf: any) => sf.key === "left");
              const operatorField = condField.subFields?.find((sf: any) => sf.key === "operator");
              const rightField = condField.subFields?.find((sf: any) => sf.key === "right");
              const extraFields = condField.subFields?.filter((sf: any) =>
                !["left", "operator", "right"].includes(sf.key)
              ) || [];

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

                  {/* Main row: Left, Operator, Right */}
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
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  {/* Extra conditional fields */}
                  {extraFields.map((sf: any) => {
                    let show = true;
                    if (sf.displayOptions?.show) {
                      for (const [depKey, allowed] of Object.entries(sf.displayOptions.show)) {
                        if (!(allowed as string[]).includes(cond[depKey])) {
                          show = false;
                          break;
                        }
                      }
                    }
                    if (!show) return null;
                    return (
                      <div key={sf.key} className="space-y-1">
                        <Label className="text-xs">{sf.label}</Label>
                        {sf.type === "select" ? (
                          <Select
                            value={cond[sf.key]}
                            onValueChange={(v) => updateCondition(i, sf.key, v)}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue placeholder={sf.placeholder || sf.label} />
                            </SelectTrigger>
                            <SelectContent>
                              {(sf.options || []).map((opt: any) => (
                                <SelectItem
                                  key={opt.id ?? opt.value}
                                  value={opt.id ?? opt.value}
                                >
                                  {opt.name || opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <>
                             <Input
                               className="w-full h-8 text-xs nodrag"
                               placeholder={sf.placeholder || sf.label}
                               value={cond[sf.key] ?? ""}
                               onChange={(e) => updateCondition(i, sf.key, e.target.value)}
                               onDragOver={(e) => {
                                 e.preventDefault();
                                 e.stopPropagation();
                                 e.dataTransfer.dropEffect = "copy";
                               }}
                               onFocus={(e) => e.target.select()}
                               style={
                                 cond[sf.key]?.includes("{{") ? referenceStyle : {}
                               }
                               onDrop={(e) => handleRepeaterDrop(i, sf.key, e, cond[sf.key] ?? "")}
                             />
                            {typeof cond[sf.key] === "string" && cond[sf.key]?.includes("{{") && (
                              <div className="text-xs text-gray-500 mt-1">
                                Preview: {getPreviewFor(i, sf.key, cond[sf.key])}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Previews for left/right */}
                  {typeof cond.left === "string" && cond.left.includes("{{") && (
                    <div className="text-xs text-gray-500">
                      Left Preview: {getPreviewFor(i, "left", cond.left)}
                    </div>
                  )}
                  {typeof cond.right === "string" && cond.right.includes("{{") && (
                    <div className="text-xs text-gray-500">
                      Right Preview: {getPreviewFor(i, "right", cond.right)}
                    </div>
                  )}
                </div>
              );
            })}

            <Button
              size="sm"
              variant="outline"
              onClick={addCondition}
              className="w-full text-xs h-8 mt-3"
            >
              + Add Condition
            </Button>
          </div>
        )}

        {/* --------- Error Message --------- */}
        {error && (
          <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded p-2">
            {error}
          </div>
        )}

        {/* --------- Submit Button --------- */}
        <Button
          type="submit"
          className="w-full bg-success hover:bg-success/90 text-success-foreground"
          disabled={isSending}
        >
          {isSending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            "Run"
          )}
        </Button>
      </form>

      {showAuth && GenericAuthModal && (
        <Suspense fallback={<div>Loading...</div>}>
          <GenericAuthModal
            definition={definition}
            onClose={() => {
              setShowAuth(false);
              (definition.fields || []).forEach((f: any) => {
                if (f.type === "select" && f.optionsSource === "credentialsApi") {
                  fetchCredentials(f.key);
                }
              });
            }}
          />
        </Suspense>
      )}
    </>
  );
};

export default ConditionalNodeLayout;