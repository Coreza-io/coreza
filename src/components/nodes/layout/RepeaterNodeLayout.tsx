/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useCallback, useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, X, Plus } from "lucide-react";
import type { BaseNodeRenderProps } from "../BaseNode";
import { useAuth } from "@/contexts/AuthContext";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import { useReactFlow } from "@xyflow/react";
import { getDisplayName } from "@/components/nodes/layout/utils/nodeDisplay";
import { operatorRequiresRightValue } from "@/components/nodes/layouts/utils/operators";
import NodeFieldRenderer from "@/components/nodes/layout/components/NodeFieldRenderer";
import LayoutAuthModal from "@/components/nodes/layout/components/LayoutAuthModal";
interface RepeaterNodeLayoutProps extends BaseNodeRenderProps {
  nodes?: any[];
  readOnly?: boolean;
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
  fetchDependentOptions,
  referenceStyle,
  previousNodes,
  selectedPrevNodeId,
  readOnly,
}) => {
  const { getNodes } = useReactFlow();
  const { user } = useAuth();

  // =========== DETERMINE REPEATER TYPE ===========
  const repeaterField = definition.fields?.find(
    (f: any) => f.type === "repeater"
  );
  const repeaterKey = repeaterField?.key;
  const isConditional = repeaterKey === "conditions";
  const isFieldRepeater = repeaterKey === "fields";
  const isSwitch = repeaterKey === "cases";
  const fallbackField = useMemo(
    () => definition.fields?.find((f: any) => f.key === "enableFallback"),
    [definition.fields]
  );

  // =========== CONDITIONAL LOGIC ===========
  const defaultCond =
    Array.isArray(repeaterField?.default) && repeaterField.default.length > 0
      ? repeaterField.default[0]
      : repeaterField?.default ?? { left: "", operator: "===", right: "" };

  // =========== SWITCH LOGIC ===========
  const defaultCase =
    isSwitch &&
    Array.isArray(repeaterField?.default) &&
    repeaterField.default.length > 0
      ? repeaterField.default
      : [{ left: "", operator: "===", right: "", outputName: "Case 1" }];

  // =========== STATE ===========
  // make sure these are always arrays before you map/filter them
  const conditions = useMemo(() => {
    const repeaterFieldState = repeaterKey
      ? fieldState?.[repeaterKey]
      : undefined;
    return Array.isArray(repeaterFieldState) ? repeaterFieldState : [];
  }, [repeaterKey, fieldState]);

  const logicalOps = useMemo(
    () =>
      isConditional && Array.isArray(fieldState.logicalOps)
        ? fieldState.logicalOps
        : [],
    [fieldState.logicalOps, isConditional]
  );

  const cases = useMemo(
    () => (Array.isArray(fieldState.cases) ? fieldState.cases : []),
    [fieldState.cases]
  );
  const [sourceMap, setSourceMap] = useState<
    { left?: string; right?: string }[]
  >(conditions.map(() => ({})));

  // ─── Seed the repeater on first render ────────────────────────────────────
  useEffect(() => {
    if (!repeaterField) return;
    const key = repeaterField.key; // "conditions", "fields" or "cases"
    const current = fieldState[key] || [];
    if (Array.isArray(current) && current.length > 0) return; // already seeded

    // 1) build the seed rows array from your manifest
    const seedRows = Array.isArray(repeaterField.default)
      ? repeaterField.default
      : repeaterField.default
      ? [repeaterField.default]
      : [{}];

    // 2) batch-set both fields: repeater + logicalOps (for If nodes)
    if (key === "conditions") {
      handleFieldStateBatch({
        conditions: seedRows,
        logicalOps: [], // no logic dropdown when only one condition
      });
    } else if (key === "cases") {
      // for Switch: just seed the cases array
      handleFieldStateBatch({ cases: seedRows });
    } else if (key === "fields") {
      handleFieldStateBatch({ fields: seedRows });
    }

    // 3) keep your sourceMap in sync
    setSourceMap(Array(seedRows.length).fill({}));
  }, []); // <- only on mount

  // whenever conditions.length changes, ensure sourceMap has the same length
  useEffect(() => {
    setSourceMap((sm) => {
      if (sm.length === conditions.length) return sm;
      if (sm.length < conditions.length) {
        return [...sm, ...Array(conditions.length - sm.length).fill({})];
      }
      return sm.slice(0, conditions.length);
    });
  }, [conditions.length]);

  // Normalize logicalOps length to match conditions - 1
  useEffect(() => {
    if (!isConditional) return;
    const targetLen = Math.max(0, conditions.length - 1);
    const currentLen = Array.isArray(logicalOps) ? logicalOps.length : 0;
    if (currentLen !== targetLen) {
      const padded = Array.from(
        { length: targetLen },
        (_, i) => logicalOps[i] || "AND"
      );
      handleFieldStateBatch({ logicalOps: padded });
    }
  }, [isConditional, conditions.length, logicalOps?.length]);

  // =========== CONDITIONAL HELPERS ===========
  const addCondition = () => {
    const newConds = [...conditions, { ...defaultCond }];
    if (isConditional) {
      const newLogOps = [...logicalOps, "AND"];
      handleFieldStateBatch({
        conditions: newConds,
        logicalOps: newLogOps,
      });
    } else {
      handleFieldStateBatch({ [repeaterKey!]: newConds });
    }
    // sourceMap still needs to grow
    setSourceMap((sm) => (Array.isArray(sm) ? [...sm, {}] : [{}]));
  };

  const removeCondition = (idx: number) => {
    // 1) compute new conditions array
    const newConds = conditions.filter((_, i) => i !== idx);

    if (isConditional) {
      // 2) compute new logicalOps—drop the op immediately before the removed condition,
      //    or if idx===0 then drop the first op.
      const removeOpIndex = idx > 0 ? idx - 1 : 0;
      const newLogOps = logicalOps.filter((_, i) => i !== removeOpIndex);

      // 3) batch-update both fields
      handleFieldStateBatch({
        conditions: newConds,
        logicalOps: newLogOps,
      });
    } else {
      handleFieldStateBatch({ [repeaterKey!]: newConds });
    }

    // 4) trim your sourceMap too
    setSourceMap((sm) =>
      Array.isArray(sm) ? sm.filter((_, i) => i !== idx) : []
    );
  };

  const updateCondition = useCallback(
    (idx: number, field: string, value: any) => {
      handleChange(
        repeaterKey!,
        conditions.map((row, i) =>
          i === idx ? { ...row, [field]: value } : row
        )
      );
    },
    [conditions, handleChange, repeaterKey]
  );

  const handleOperatorSelect = useCallback(
    (idx: number, value: string) => {
      handleChange(
        repeaterKey!,
        conditions.map((row, rowIdx) => {
          if (rowIdx !== idx) return row;
          const updated = { ...row, operator: value } as any;

          if (!operatorRequiresRightValue(value)) {
            updated.right = "";
          }

          return updated;
        })
      );
    },
    [conditions, handleChange, repeaterKey]
  );

  const updateLogicalOp = useCallback(
    (idx: number, op: string) => {
      if (!logicalOps || logicalOps.length === 0) {
        // nothing yet → just seed with this op
        handleChange("logicalOps", [op]);
      } else {
        // update in place
        handleChange(
          "logicalOps",
          logicalOps.map((v, i) => (i === idx ? op : v))
        );
      }
    },
    [logicalOps, handleChange]
  );

  // =========== SWITCH HELPERS ===========
  const addCase = () => {
    const newIndex = cases.length + 1;
    handleChange("cases", [
      ...cases,
      {
        left: "",
        operator: "===",
        right: "",
        outputName: `Case ${newIndex}`,
      },
    ]);
  };

  const removeCase = (idx: number) => {
    handleChange(
      "cases",
      cases.filter((_, i) => i !== idx)
    );
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
      return val.map((v) => resolveDeep(v, selectedInputData, allNodeData));
    }
    if (typeof val === "object" && val !== null) {
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) => [
          k,
          resolveDeep(v, selectedInputData, allNodeData),
        ])
      );
    }
    return val;
  }

  const computeDropInsert = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) return null;

      try {
        const { keyPath = "" } = JSON.parse(raw);
        const sourceNode = previousNodes.find(
          (n) => n.id === selectedPrevNodeId
        );
        const sourceDisplayName =
          sourceNode?.data?.displayName ||
          (sourceNode
            ? getDisplayName(sourceNode, previousNodes)
            : selectedPrevNodeId);
        const kp = (keyPath ?? "").trim();
        const suffix = kp ? `.${kp}` : "";

        return {
          insert: `{{ $('${sourceDisplayName}').json${suffix} }}`,
          sourceId: selectedPrevNodeId,
        };
      } catch (error) {
        console.error("Drop error:", error);
        return null;
      }
    },
    [previousNodes, selectedPrevNodeId]
  );

  const handleDropWithInsert = useCallback(
    (
      e: React.DragEvent,
      currentValue: string,
      onInsert: (insert: string, sourceId: string) => void
    ) => {
      e.preventDefault();
      e.stopPropagation();

      const result = computeDropInsert(e);
      if (!result) {
        document.body.classList.remove("cursor-grabbing", "select-none");
        return;
      }

      onInsert(result.insert, result.sourceId);
      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [computeDropInsert]
  );

  // Drag helper for repeater (conditional)
  const handleRepeaterDrop = useCallback(
    (idx: number, field: string, e: React.DragEvent, currentValue: string) => {
      handleDropWithInsert(e, currentValue, (insert, sourceId) => {
        updateCondition(idx, field, currentValue + insert);

        setSourceMap((sm) => {
          const next = Array.isArray(sm) ? [...sm] : [];
          next[idx] = {
            ...(next[idx] || {}),
            [field]: sourceId,
          };
          return next;
        });
      });
    },
    [handleDropWithInsert, updateCondition]
  );

  // Drag helper for switch
  const handleSwitchDrop = useCallback(
    (field: string, e: React.DragEvent, currentValue: string) => {
      handleDropWithInsert(e, currentValue, (insert) => {
        handleChange(field, currentValue + insert);
      });
    },
    [handleDropWithInsert, handleChange]
  );

  const handleSwitchConditionDrop = useCallback(
    (idx: number, field: string, e: React.DragEvent, currentValue: string) => {
      handleDropWithInsert(e, currentValue, (insert) => {
        updateCase(idx, field, currentValue + insert);
      });
    },
    [handleDropWithInsert, updateCase]
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

      const srcData = srcNode.data?.output || {};

      const allNodeData = {} as Record<string, any>;
      previousNodes.forEach((prevNode) => {
        const displayName = prevNode.id;
        const nodeData = prevNode.data?.output || prevNode.data || {};
        allNodeData[displayName] = nodeData;
      });

      try {
        const resolved = resolveDeep(expr, srcData, allNodeData);

        // Extract timezone from source node
        const nodeMatch =
          typeof expr === "string"
            ? expr.match(/\$\(['"]([^'"]+)['"]\)/)
            : null;
        let timezone: string | undefined;

        if (nodeMatch) {
          const sourceName = nodeMatch[1];
          const sourceData = allNodeData[sourceName];
          timezone =
            sourceData?.schedule?.timezone ||
            sourceData?.timezone ||
            sourceData?.config?.timezone;
        }

        return summarizePreview(resolved, 3, 100, timezone);
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

      const srcData =
        srcNode.data?.output ||
        srcNode.data?.input ||
        srcNode.data?.values ||
        {};

      const allNodeData = {} as Record<string, any>;
      previousNodes.forEach((prevNode) => {
        const displayName = prevNode.id;
        const nodeData = prevNode.data?.output || prevNode.data || {};
        allNodeData[displayName] = nodeData;
      });

      try {
        const resolved = resolveDeep(expr, srcData, allNodeData);

        // Extract timezone from source node
        const nodeMatch =
          typeof expr === "string"
            ? expr.match(/\$\(['"]([^'"]+)['"]\)/)
            : null;
        let timezone: string | undefined;

        if (nodeMatch) {
          const sourceName = nodeMatch[1];
          const sourceData = allNodeData[sourceName];
          timezone =
            sourceData?.schedule?.timezone ||
            sourceData?.timezone ||
            sourceData?.config?.timezone;
        }

        return summarizePreview(resolved, 3, 100, timezone);
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
            {definition?.def || definition?.name || "Node"}
          </h2>
        </div>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit}>
        {/* Top-level fields (non-repeater) */}
        {(definition.fields || []).map((f: any) => {
          if (f.type === "repeater") return null;
          if (isConditional && f.key === "logicalOp") return null; // Handle logicalOp after conditions for If nodes
          if (isSwitch && f.key === "enableFallback") return null; // Render fallback toggle with cases section

          return (
            <NodeFieldRenderer
              key={f.key}
              field={f}
              definition={definition}
              fieldState={fieldState}
              value={fieldState[f.key]}
              selectOptions={selectOptions}
              loadingSelect={loadingSelect}
              onChange={handleChange}
              onBatchChange={handleFieldStateBatch}
              onDrop={(fieldDef, e, currentValue) => {
                if (isSwitch) {
                  handleSwitchDrop(fieldDef.key, e, currentValue);
                } else {
                  handleDrop(
                    fieldDef.key,
                    (val: string) => handleChange(fieldDef.key, val),
                    e,
                    currentValue
                  );
                }
              }}
              getPreview={(fieldKey) =>
                isSwitch
                  ? getSwitchPreviewFor(fieldState[fieldKey])
                  : getFieldPreview(fieldKey)
              }
              referenceStyle={referenceStyle}
              fetchDependentOptions={fetchDependentOptions}
              setShowAuth={setShowAuth}
              readOnly={readOnly}
            />
          );
        })}

        {/* --------- CONDITIONAL/FIELDS REPEATER --------- */}
        {(isConditional || isFieldRepeater) && repeaterField && (
          <div className="space-y-3">
            <h4 className="font-semibold">
              {repeaterField?.key === "conditions" ||
              repeaterField?.type === "conditions"
                ? "Conditions"
                : "Fields"}
            </h4>

            {conditions.map((cond, i) => {
              const leftField = repeaterField.subFields?.find(
                (sf: any) => sf.key === "left"
              );
              const operatorField = repeaterField.subFields?.find(
                (sf: any) => sf.key === "operator"
              );
              const rightField = repeaterField.subFields?.find(
                (sf: any) => sf.key === "right"
              );
              const persistentField = repeaterField.subFields?.find(
                (sf: any) => sf.key === "persistent"
              );
              const showRightField = operatorRequiresRightValue(cond.operator);

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

                  <div className="grid grid-cols-1 md:grid-cols-[1.5fr_auto_1.5fr_auto] gap-2 items-start p-2 border rounded bg-muted/10">
                    {leftField && (
                      <NodeFieldRenderer
                        field={leftField}
                        definition={definition}
                        fieldState={{
                          ...fieldState,
                          [leftField.key]: cond.left,
                        }}
                        value={cond.left}
                        selectOptions={selectOptions}
                        loadingSelect={loadingSelect}
                        onChange={(key, val) => updateCondition(i, key, val)}
                        onDrop={(fieldDef, e, currentValue) =>
                          handleRepeaterDrop(i, fieldDef.key, e, currentValue)
                        }
                        getPreview={() => getPreviewFor(i, "left", cond.left)}
                        referenceStyle={referenceStyle}
                        fetchDependentOptions={fetchDependentOptions}
                        setShowAuth={setShowAuth}
                        readOnly={readOnly}
                      />
                    )}

                    {operatorField && (
                      <div className="min-w-0">
                        <NodeFieldRenderer
                          field={operatorField}
                          definition={definition}
                          fieldState={{
                            ...fieldState,
                            [operatorField.key]: cond.operator,
                          }}
                          value={cond.operator}
                          selectOptions={selectOptions}
                          loadingSelect={loadingSelect}
                          onChange={(key, val) => handleOperatorSelect(i, val)}
                          referenceStyle={referenceStyle}
                          fetchDependentOptions={fetchDependentOptions}
                          setShowAuth={setShowAuth}
                          readOnly={readOnly}
                        />
                      </div>
                    )}

                    {rightField && showRightField && (
                      <NodeFieldRenderer
                        field={rightField}
                        definition={definition}
                        fieldState={{
                          ...fieldState,
                          [rightField.key]: cond.right,
                        }}
                        value={cond.right}
                        selectOptions={selectOptions}
                        loadingSelect={loadingSelect}
                        onChange={(key, val) => updateCondition(i, key, val)}
                        onDrop={(fieldDef, e, currentValue) =>
                          handleRepeaterDrop(i, fieldDef.key, e, currentValue)
                        }
                        getPreview={() => getPreviewFor(i, "right", cond.right)}
                        referenceStyle={referenceStyle}
                        fetchDependentOptions={fetchDependentOptions}
                        setShowAuth={setShowAuth}
                        readOnly={readOnly}
                      />
                    )}

                    {conditions.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeCondition(i)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        disabled={readOnly}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>

                  {persistentField && (
                    <NodeFieldRenderer
                      field={persistentField}
                      definition={definition}
                      fieldState={{
                        ...fieldState,
                        [persistentField.key]: cond.persistent,
                      }}
                      value={cond.persistent}
                      selectOptions={selectOptions}
                      loadingSelect={loadingSelect}
                      onChange={(key, val) => updateCondition(i, key, val)}
                      referenceStyle={referenceStyle}
                      fetchDependentOptions={fetchDependentOptions}
                      setShowAuth={setShowAuth}
                      readOnly={readOnly}
                    />
                  )}
                </div>
              );
            })}

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addCondition}
              className="flex items-center gap-2"
              disabled={readOnly}
            >
              <Plus className="w-3 h-3" />
              Add {isConditional ? "Condition" : "Field"}
            </Button>

            {isConditional &&
              conditions.length > 1 &&
              definition.fields?.map((f: any) =>
                f.key === "logicalOp" ? (
                  <NodeFieldRenderer
                    key={f.key}
                    field={f}
                    definition={definition}
                    fieldState={fieldState}
                    value={fieldState[f.key]}
                    selectOptions={selectOptions}
                    loadingSelect={loadingSelect}
                    onChange={handleChange}
                    referenceStyle={referenceStyle}
                    fetchDependentOptions={fetchDependentOptions}
                    setShowAuth={setShowAuth}
                    readOnly={readOnly}
                  />
                ) : null
              )}
          </div>
        )}

        {/* --------- SWITCH REPEATER (Cases) --------- */}
        {isSwitch && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Cases</h4>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addCase}
                className="h-7 px-2"
                disabled={readOnly}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Case
              </Button>
            </div>

            {cases.map((caseItem, i) => {
              const leftField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "left"
              );
              const operatorSubField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "operator"
              );
              const rightField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "right"
              );
              const outputField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "outputName"
              );
              const showRightField = operatorRequiresRightValue(
                caseItem.operator
              );

              return (
                <div key={i} className="space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-[1.5fr_auto_1.5fr_auto] gap-2 items-start p-2 border rounded bg-muted/10">
                    {leftField && (
                      <NodeFieldRenderer
                        field={leftField}
                        definition={definition}
                        fieldState={{
                          ...fieldState,
                          [leftField.key]: caseItem.left,
                        }}
                        value={caseItem.left}
                        selectOptions={selectOptions}
                        loadingSelect={loadingSelect}
                        onChange={(key, val) => updateCase(i, key, val)}
                        onDrop={(fieldDef, e, currentValue) =>
                          handleSwitchConditionDrop(
                            i,
                            fieldDef.key,
                            e,
                            currentValue
                          )
                        }
                        getPreview={() => getSwitchPreviewFor(caseItem.left)}
                        referenceStyle={referenceStyle}
                        fetchDependentOptions={fetchDependentOptions}
                        setShowAuth={setShowAuth}
                        readOnly={readOnly}
                      />
                    )}

                    {operatorSubField && (
                      <div className="min-w-0">
                        <NodeFieldRenderer
                          field={operatorSubField}
                          definition={definition}
                          fieldState={{
                            ...fieldState,
                            [operatorSubField.key]: caseItem.operator,
                          }}
                          value={caseItem.operator}
                          selectOptions={selectOptions}
                          loadingSelect={loadingSelect}
                          onChange={(key, val) => updateCase(i, key, val)}
                          referenceStyle={referenceStyle}
                          fetchDependentOptions={fetchDependentOptions}
                          setShowAuth={setShowAuth}
                          readOnly={readOnly}
                        />
                      </div>
                    )}

                    {rightField && showRightField && (
                      <NodeFieldRenderer
                        field={rightField}
                        definition={definition}
                        fieldState={{
                          ...fieldState,
                          [rightField.key]: caseItem.right,
                        }}
                        value={caseItem.right}
                        selectOptions={selectOptions}
                        loadingSelect={loadingSelect}
                        onChange={(key, val) => updateCase(i, key, val)}
                        onDrop={(fieldDef, e, currentValue) =>
                          handleSwitchConditionDrop(
                            i,
                            fieldDef.key,
                            e,
                            currentValue
                          )
                        }
                        getPreview={() => getSwitchPreviewFor(caseItem.right)}
                        referenceStyle={referenceStyle}
                        fetchDependentOptions={fetchDependentOptions}
                        setShowAuth={setShowAuth}
                        readOnly={readOnly}
                      />
                    )}

                    {cases.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeCase(i)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                        disabled={readOnly}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>

                  {outputField && (
                    <NodeFieldRenderer
                      field={outputField}
                      definition={definition}
                      fieldState={{
                        ...fieldState,
                        [outputField.key]:
                          caseItem.outputName ||
                          caseItem.caseName ||
                          caseItem.caseValue,
                      }}
                      value={
                        caseItem.outputName ||
                        caseItem.caseName ||
                        caseItem.caseValue
                      }
                      selectOptions={selectOptions}
                      loadingSelect={loadingSelect}
                      onChange={(key, val) => updateCase(i, key, val)}
                      referenceStyle={referenceStyle}
                      fetchDependentOptions={fetchDependentOptions}
                      setShowAuth={setShowAuth}
                      readOnly={readOnly}
                    />
                  )}
                </div>
              );
            })}

            {fallbackField && (
              <NodeFieldRenderer
                field={fallbackField}
                definition={definition}
                fieldState={fieldState}
                value={fieldState[fallbackField.key]}
                selectOptions={selectOptions}
                loadingSelect={loadingSelect}
                onChange={(key, val) => handleChange(key, val)}
                referenceStyle={referenceStyle}
                fetchDependentOptions={fetchDependentOptions}
                setShowAuth={setShowAuth}
                readOnly={readOnly}
              />
            )}
          </div>
        )}

        {/* Submit Button */}
        {!readOnly && (
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
        )}

        {/* Error Display */}
        {error && (
          <div className="text-red-500 text-xs mt-2 p-2 bg-red-50 rounded">
            {error}
          </div>
        )}
      </form>

      {/* Auth Modal */}
      <LayoutAuthModal
        definition={definition}
        showAuth={showAuth}
        readOnly={readOnly}
        setShowAuth={setShowAuth}
        fetchCredentials={fetchCredentials}
        userId={user?.id || ""}
      />
    </>
  );
};

export default RepeaterNodeLayout;
