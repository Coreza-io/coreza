import React, { Suspense, useCallback, useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, X, Plus } from "lucide-react";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import type { BaseNodeRenderProps } from "../BaseNode";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import { useReactFlow } from "@xyflow/react";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
const getDisplayName = (node: any, allNodes: any[]) => {
  const baseName = node.data.definition?.name;
  const sameType = allNodes.filter((n) => n && n.data && (n.data.definition?.name) === baseName);
  const idx = sameType.findIndex((n) => n.id === node.id);
  const result = idx > 0 ? `${baseName}${idx}` : baseName;
  
  return result;
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
  handleFieldStateBatch,
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
  const isConditional = repeaterField?.key === "conditions" || repeaterField?.key === "fields";
  const isSwitch = repeaterField?.key === "cases";

  // =========== CONDITIONAL LOGIC ===========
  const defaultCond = Array.isArray(repeaterField?.default) && repeaterField.default.length > 0
    ? repeaterField.default[0]
    : (repeaterField?.default ?? { left: "", operator: "===", right: "" });

  // =========== SWITCH LOGIC ===========
  const defaultCase = isSwitch && Array.isArray(repeaterField?.default) && repeaterField.default.length > 0
    ? repeaterField.default
    : [{ caseValue: "case1", caseName: "Case 1" }];

  // =========== STATE ===========
  // make sure these are always arrays before you map/filter them
  const conditions = Array.isArray(fieldState.conditions) 
    ? fieldState.conditions 
    : [];
  const logicalOps = Array.isArray(fieldState.logicalOps) 
    ? fieldState.logicalOps 
    : [];
  const cases = Array.isArray(fieldState.cases) 
    ? fieldState.cases 
    : [];
  const [sourceMap, setSourceMap] = useState<{ left?: string; right?: string }[]>(conditions.map(() => ({})));

  // ─── Seed the repeater on first render ────────────────────────────────────
  const [hasSeeded, setHasSeeded] = useState(false);
  
  useEffect(() => {
    if (!repeaterField || hasSeeded) return;
    const key = repeaterField.key;         // "conditions" or "cases"
    const current = fieldState[key] || [];
    if (Array.isArray(current) && current.length > 0) {
      setHasSeeded(true);
      return; // already has data, don't seed
    }

    // 1) build the seed rows array from your manifest
    const seedRows = Array.isArray(repeaterField.default)
      ? repeaterField.default
      : repeaterField.default
        ? [repeaterField.default]
        : [{}];

    // 2) batch-set both fields: repeater + logicalOps (for If nodes)
    if (key === "conditions") {
      handleFieldStateBatch({
        conditions:  seedRows,
        logicalOps:  []        // no logic dropdown when only one condition
      });
    } else {
      // for Switch: just seed the cases array
      handleFieldStateBatch({ cases: seedRows });
    }

    // 3) keep your sourceMap in sync
    setSourceMap(Array(seedRows.length).fill({}));
    setHasSeeded(true);
  }, [repeaterField, hasSeeded, fieldState, handleFieldStateBatch]);  // <- track seeding state


  // whenever conditions.length changes, ensure sourceMap has the same length
  useEffect(() => {
    setSourceMap((sm) => {
      if (sm.length === conditions.length) return sm;
      if (sm.length <  conditions.length) {
        return [...sm, ...Array(conditions.length - sm.length).fill({})];
      }
      return sm.slice(0, conditions.length);
    });
  }, [conditions.length]);

  // =========== CONDITIONAL HELPERS ===========
  const addCondition = () => {
    const newConds    = [...conditions, { ...defaultCond }];
    const newLogOps   = [...logicalOps, "AND"];
    handleFieldStateBatch({
      conditions:  newConds,
      logicalOps:  newLogOps
    });
    // sourceMap still needs to grow
    setSourceMap(sm => Array.isArray(sm) ? [...sm, {}] : [{}]);
  };

  const removeCondition = (idx: number) => {
    // 1) compute new conditions array
    const newConds = conditions.filter((_, i) => i !== idx);

    // 2) compute new logicalOps—drop the op immediately before the removed condition,
    //    or if idx===0 then drop the first op.
    const removeOpIndex = idx > 0 ? idx - 1 : 0;
    const newLogOps = logicalOps.filter((_, i) => i !== removeOpIndex);

    // 3) batch-update both fields
    handleFieldStateBatch({
      conditions: newConds,
      logicalOps: newLogOps,
    });

    // 4) trim your sourceMap too
    setSourceMap((sm) => Array.isArray(sm) ? sm.filter((_, i) => i !== idx) : []);
  };

  const updateCondition = useCallback(
    (idx: number, field: string, value: any) => {
      handleChange(
        "conditions",
        conditions.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
      );
    },
    [conditions, handleChange]
  );

  const updateLogicalOp = useCallback(
    (idx: number, op: string) => {
      handleChange(
        "logicalOps",
        logicalOps.map((v, i) => (i === idx ? op : v))
      );
    },
    [logicalOps, handleChange]
  );

  // =========== SWITCH HELPERS ===========
  const addCase = () => {
    const newIndex = cases.length + 1;
    handleChange("cases", [...cases, { caseValue: `case${newIndex}`, caseName: `Case ${newIndex}` }]);
  };

  const removeCase = (idx: number) => {
    handleChange("cases", cases.filter((_, i) => i !== idx));
  };

  const updateCase = useCallback(
    (idx: number, field: string, value: string) => {
      handleChange(
        "cases",
        cases.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
      );
    },
    [cases, handleChange]
  );


  // =========== SHARED HELPERS ===========
  function resolveDeep(val, selectedInputData, allNodeData) {
    if (typeof val === "string") {
      const allNodes = getNodes();
      return resolveReferences(val, selectedInputData, allNodeData, allNodes);
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
        const { keyPath = "" } = JSON.parse(raw);
        const sourceNode = previousNodes.find((n) => n.id === selectedPrevNodeId);
        const sourceDisplayName = sourceNode?.data?.displayName || (sourceNode ? getDisplayName(sourceNode, previousNodes) : selectedPrevNodeId);
        const kp = (keyPath ?? "").trim();
        const suffix = kp ? `.${kp}` : "";
        const insert = `{{ $('${sourceDisplayName}').json${suffix} }}`;

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
        const { keyPath = "" } = JSON.parse(raw);
        const sourceNode = previousNodes.find((n) => n.id === selectedPrevNodeId);
        const sourceDisplayName = sourceNode?.data?.displayName || (sourceNode ? getDisplayName(sourceNode, previousNodes) : selectedPrevNodeId);
        const kp = (keyPath ?? "").trim();
        const suffix = kp ? `.${kp}` : "";
        const insert = `{{ $('${sourceDisplayName}').json${suffix} }}`;

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

      let srcData = srcNode.data?.output || {};

      const allNodeData = {} as Record<string, any>;
      previousNodes.forEach(prevNode => {
        const displayName = prevNode.id;
        const nodeData = prevNode.data?.output || prevNode.data || {};
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

      const allNodeData = {} as Record<string, any>;
      previousNodes.forEach(prevNode => {
        const displayName = prevNode.id;
        const nodeData = prevNode.data?.output || prevNode.data || {};
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
          if (isConditional && f.key === "logicalOp") return null; // Handle logicalOp after conditions for If nodes
          
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
                  style={typeof fieldState[f.key] === "string" && fieldState[f.key].includes("{{") ? referenceStyle : undefined}
                  onFocus={(e) => e.target.select()}
                />
                  {typeof fieldState[f.key] === "string" && fieldState[f.key].includes("{{") && (
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
                  onValueChange={(val) => {
                    handleChange(f.key, val);
                    // Clear dependent field when parent changes
                    if (f.conditionalOptions) {
                      const dependentFields = definition.fields?.filter((field: any) => field.dependsOn === f.key);
                      dependentFields?.forEach((depField: any) => {
                        handleChange(depField.key, "");
                      });
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={f.placeholder || "Select option"} />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      // Handle conditional options
                      if (f.dependsOn && f.conditionalOptions) {
                        const parentValue = fieldState[f.dependsOn];
                        const conditionalOptions = f.conditionalOptions[parentValue] || [];
                        return conditionalOptions.map((option: any) => (
                          <SelectItem key={option.id || option.value} value={option.id || option.value}>
                            {option.name || option.label || option.id || option.value}
                          </SelectItem>
                        ));
                      }
                      // Handle regular options
                      return (selectOptions[f.key] || f.options || []).map((opt: any) => (
                        <SelectItem
                          key={opt.id || opt.value}
                          value={opt.id || opt.value}
                        >
                          {opt.name || opt.label || opt.id || opt.value}
                        </SelectItem>
                      ));
                    })()}
                  </SelectContent>
                </Select>
              )}

              {/* --------- Multiselect Field --------- */}
              {f.type === "multiselect" && (
                <div className="space-y-3">
                  {((selectOptions[f.key] || f.options || [])).map((opt: any) => {
                    const optionId = opt.id || opt.value;
                    const optionLabel = opt.name || opt.label || opt.id || opt.value;
                    const selectedValues = Array.isArray(fieldState[f.key]) ? fieldState[f.key] : (f.default || []);
                    const isSelected = selectedValues.includes(optionId);
                    
                    return (
                      <div key={optionId} className="flex items-center justify-between">
                        <span className="text-sm text-foreground">{optionLabel}</span>
                        <Switch
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            const currentValues = Array.isArray(fieldState[f.key]) ? fieldState[f.key] : (f.default || []);
                            let newValues;
                            if (checked) {
                              newValues = [...currentValues, optionId];
                            } else {
                              newValues = currentValues.filter((v: string) => v !== optionId);
                            }
                            handleChange(f.key, newValues);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* --------- Checkbox Field --------- */}
              {f.type === "checkbox" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">{f.label}</span>
                  <Switch
                    checked={!!fieldState[f.key]}
                    onCheckedChange={(checked) => handleChange(f.key, checked)}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* --------- CONDITIONAL REPEATER (Conditions) --------- */}
        {isConditional && repeaterField && (
          <div className="space-y-3">
            <h4 className="font-semibold">
              {repeaterField?.key === "conditions" || repeaterField?.type === "conditions"
                ? "Conditions"
                : "Fields"}
            </h4>

            {conditions.map((cond, i) => {
              const leftField = repeaterField.subFields?.find((sf: any) => sf.key === "left");
              const operatorField = repeaterField.subFields?.find((sf: any) => sf.key === "operator");
              const rightField = repeaterField.subFields?.find((sf: any) => sf.key === "right");
              const persistentField = repeaterField.subFields?.find((sf: any) => sf.key === "persistent");

              return (
                <div key={i} className="space-y-2">
                  {repeaterField?.key === "conditions" && i > 0 && (
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
              onClick={addCondition} // You can rename this to a generic handler if needed
              className="h-7 px-2"
            >
              <Plus className="w-3 h-3 mr-1" />
              {repeaterField?.key === "conditions" ? "Add Condition" : "Add Field"}
            </Button>

            {/* --------- LOGICAL OPERATOR (If nodes only, after conditions) --------- */}
            {isConditional && conditions.length > 1 && definition.fields?.map((f: any) => {
              if (f.key !== "logicalOp") return null;
              
              return (
                <div key={f.key} className="mt-3">
                  <Label>{f.label}</Label>
                  <Select
                    value={fieldState[f.key] || f.default}
                    onValueChange={(val) => handleChange(f.key, val)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={f.placeholder || "Select logical operator"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(f.options || []).map((opt: any) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {f.description && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {f.description}
                    </div>
                  )}
                </div>
              );
            })}
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