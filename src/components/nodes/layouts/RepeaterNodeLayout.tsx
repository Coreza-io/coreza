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

import React, {
  Suspense,
  useCallback,
  useState,
  useEffect,
  useMemo,
} from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Loader2, X, Plus } from "lucide-react";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import { SchwabAuthModal } from "@/components/auth/SchwabAuthModal";
import type { BaseNodeRenderProps } from "../BaseNode";
import { useAuth } from "@/contexts/AuthContext";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import { useReactFlow } from "@xyflow/react";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
const getDisplayName = (node: any, allNodes: any[]) => {
  const baseName = node.data.definition?.name;
  const sameType = allNodes.filter(
    (n) => n && n.data && n.data.definition?.name === baseName
  );
  const idx = sameType.findIndex((n) => n.id === node.id);
  const result = idx > 0 ? `${baseName}${idx}` : baseName;

  return result;
};

interface RepeaterNodeLayoutProps extends BaseNodeRenderProps {
  nodes?: any[];
  readOnly?: boolean;
}

const OPERATORS_WITHOUT_RIGHT_VALUE = new Set([
  "exists",
  "not_exists",
  "is_empty",
  "is_not_empty",
  "is_true",
  "is_false",
  "array_is_empty",
  "array_is_not_empty",
  "object_is_empty",
  "object_is_not_empty",
  "isNull",
  "is_not_null",
]);

const operatorRequiresRightValue = (operator?: string) =>
  operator ? !OPERATORS_WITHOUT_RIGHT_VALUE.has(operator) : true;

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
  const { setNodes, setEdges, getNodes } = useReactFlow();
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
  const conditions =
    repeaterKey && Array.isArray(fieldState[repeaterKey])
      ? fieldState[repeaterKey]
      : [];
  const logicalOps =
    isConditional && Array.isArray(fieldState.logicalOps)
      ? fieldState.logicalOps
      : [];
  const cases = Array.isArray(fieldState.cases) ? fieldState.cases : [];
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

  const getOperatorDisplay = (
    operatorValue: string,
    groupedOptions: Record<
      string,
      {
        icon: string;
        label: string;
        options: { label: string; value: string }[];
      }
    >
  ) => {
    for (const [, typeData] of Object.entries(groupedOptions)) {
      const option = typeData.options.find(
        (opt) => opt.value === operatorValue
      );
      if (option) {
        return {
          icon: typeData.icon,
          label: option.label,
          type: typeData.label,
        };
      }
    }
    return { icon: "?", label: operatorValue, type: "Unknown" };
  };

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

  // Drag helper for repeater (conditional)
  const handleRepeaterDrop = useCallback(
    (idx: number, field: string, e: React.DragEvent, currentValue: string) => {
      e.preventDefault();
      e.stopPropagation();

      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) {
        document.body.classList.remove("cursor-grabbing", "select-none");
        return;
      }
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
    (field: string, e: React.DragEvent, currentValue: string) => {
      e.preventDefault();
      e.stopPropagation();

      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) {
        document.body.classList.remove("cursor-grabbing", "select-none");
        return;
      }
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
        const insert = `{{ $('${sourceDisplayName}').json${suffix} }}`;

        handleChange(field, currentValue + insert);
      } catch (error) {
        console.error("Drop error:", error);
      }
      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [selectedPrevNodeId, handleChange, previousNodes]
  );

  const handleSwitchConditionDrop = useCallback(
    (idx: number, field: string, e: React.DragEvent, currentValue: string) => {
      e.preventDefault();
      e.stopPropagation();

      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) {
        document.body.classList.remove("cursor-grabbing", "select-none");
        return;
      }
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
        const insert = `{{ $('${sourceDisplayName}').json${suffix} }}`;

        updateCase(idx, field, currentValue + insert);
      } catch (error) {
        console.error("Drop error:", error);
      }
      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [selectedPrevNodeId, updateCase, previousNodes]
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

          // --------- CONDITIONAL FIELD DISPLAY ---------
          let shouldShow = true;
          if (f.displayOptions && f.displayOptions.show) {
            for (const [depKey, allowedValuesRaw] of Object.entries(
              f.displayOptions.show
            )) {
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
              {f.type !== "toggle" && <Label>{f.label}</Label>}

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
                    style={
                      typeof fieldState[f.key] === "string" &&
                      fieldState[f.key].includes("{{")
                        ? referenceStyle
                        : undefined
                    }
                    onFocus={(e) => e.target.select()}
                  />
                  {typeof fieldState[f.key] === "string" &&
                    fieldState[f.key].includes("{{") && (
                      <div className="text-xs text-gray-500 mt-1">
                        Preview:{" "}
                        {isSwitch
                          ? getSwitchPreviewFor(fieldState[f.key])
                          : getFieldPreview(f.key)}
                      </div>
                    )}
                </div>
              )}

              {/* --------- Select (Credential) Field --------- */}
              {f.type === "select" && f.optionsSource === "credentialsApi" ? (
                <div className="flex gap-2 items-center">
                  <Select
                    value={fieldState[f.key]}
                    onValueChange={(val) => {
                      handleChange(f.key, val);
                      // Fetch options for dependent API fields
                      const dependentApiFields = definition.fields?.filter(
                        (field: any) =>
                          field.dependsOn === f.key &&
                          field.optionsSource === "dependentApi"
                      );
                      dependentApiFields?.forEach((depField: any) => {
                        fetchDependentOptions(depField, val);
                      });
                    }}
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

              {/* --------- Dependent API Select Field --------- */}
              {f.type === "select" && f.optionsSource === "dependentApi" && (
                <div className="flex flex-col gap-2">
                  <Select
                    value={fieldState[f.key]}
                    onValueChange={(val) => handleChange(f.key, val)}
                    disabled={loadingSelect[f.key] || !fieldState[f.dependsOn]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          !fieldState[f.dependsOn]
                            ? `Select ${f.dependsOn} first`
                            : loadingSelect[f.key]
                            ? "Loading..."
                            : f.placeholder || "Select option"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectOptions[f.key] || []).length > 0 ? (
                        selectOptions[f.key].map((option: any) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-options" disabled>
                          {!fieldState[f.dependsOn]
                            ? "Select credential first"
                            : "No accounts found"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* --------- Store Workflows API Select Field --------- */}
              {f.type === "select" &&
                f.optionsSource === "storeWorkflowsApi" && (
                  <Select
                    value={fieldState[f.key] || undefined}
                    onValueChange={(val) => {
                      // Build batch update to avoid stale closure issue
                      const updates: Record<string, any> = { [f.key]: val };

                      // Clear dependent variable fields when workflow changes
                      const variableFields = definition.fields?.filter(
                        (field: any) =>
                          field.optionsSource === "storeVariablesApi" &&
                          field.dependsOn === f.key
                      );
                      variableFields?.forEach((varField: any) => {
                        updates[varField.key] = "";
                      });

                      handleFieldStateBatch(updates);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          loadingSelect[f.key]
                            ? "Loading workflows..."
                            : f.placeholder || "Select workflow"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectOptions[f.key] || []).length > 0 ? (
                        (selectOptions[f.key] || []).map((workflow: any) => (
                          <SelectItem
                            key={workflow.id || workflow.value}
                            value={workflow.id || workflow.value}
                          >
                            {workflow.name || workflow.label || workflow.id}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-workflows" disabled>
                          {loadingSelect[f.key]
                            ? "Loading..."
                            : "No workflows found"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}

              {/* --------- Store Variables API Select Field --------- */}
              {f.type === "select" &&
                f.optionsSource === "storeVariablesApi" && (
                  <Select
                    value={fieldState[f.key] || undefined}
                    onValueChange={(val) => handleChange(f.key, val)}
                    disabled={loadingSelect[f.key] || !fieldState[f.dependsOn]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          !fieldState[f.dependsOn]
                            ? "Select workflow first"
                            : loadingSelect[f.key]
                            ? "Loading variables..."
                            : f.placeholder || "Select variable"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectOptions[f.key] || []).length > 0 ? (
                        selectOptions[f.key].map((variable: any) => (
                          <SelectItem key={variable.id} value={variable.id}>
                            {variable.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-variables" disabled>
                          {!fieldState[f.dependsOn]
                            ? "Select workflow first"
                            : loadingSelect[f.key]
                            ? "Loading..."
                            : "No variables found"}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}

              {/* --------- Regular Select Field --------- */}
              {f.type === "select" &&
                f.optionsSource !== "credentialsApi" &&
                f.optionsSource !== "dependentApi" &&
                f.optionsSource !== "storeWorkflowsApi" &&
                f.optionsSource !== "storeVariablesApi" && (
                  <Select
                    value={fieldState[f.key]}
                    onValueChange={(val) => {
                      handleChange(f.key, val);
                      // Clear dependent field when parent changes
                      if (f.conditionalOptions) {
                        const dependentFields = definition.fields?.filter(
                          (field: any) => field.dependsOn === f.key
                        );
                        dependentFields?.forEach((depField: any) => {
                          handleChange(depField.key, "");
                        });
                      }
                      // Fetch options for dependent API fields
                      const dependentApiFields = definition.fields?.filter(
                        (field: any) =>
                          field.dependsOn === f.key &&
                          field.optionsSource === "dependentApi"
                      );
                      dependentApiFields?.forEach((depField: any) => {
                        fetchDependentOptions(depField, val);
                      });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={f.placeholder || "Select option"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        // Handle conditional options
                        if (f.dependsOn && f.conditionalOptions) {
                          const parentValue = fieldState[f.dependsOn];
                          const conditionalOptions =
                            f.conditionalOptions[parentValue] || [];
                          return conditionalOptions.map((option: any) => (
                            <SelectItem
                              key={option.id || option.value}
                              value={option.id || option.value}
                            >
                              {option.name ||
                                option.label ||
                                option.id ||
                                option.value}
                            </SelectItem>
                          ));
                        }
                        // Handle regular options
                        return (selectOptions[f.key] || f.options || []).map(
                          (opt: any) => (
                            <SelectItem
                              key={opt.id || opt.value}
                              value={opt.id || opt.value}
                            >
                              {opt.name || opt.label || opt.id || opt.value}
                            </SelectItem>
                          )
                        );
                      })()}
                    </SelectContent>
                  </Select>
                )}

              {/* --------- Multiselect Field --------- */}
              {f.type === "multiselect" && (
                <div className="space-y-3">
                  {(selectOptions[f.key] || f.options || []).map((opt: any) => {
                    const optionId = opt.id || opt.value;
                    const optionLabel =
                      opt.name || opt.label || opt.id || opt.value;
                    const selectedValues = Array.isArray(fieldState[f.key])
                      ? fieldState[f.key]
                      : f.default || [];
                    const isSelected = selectedValues.includes(optionId);

                    return (
                      <div
                        key={optionId}
                        className="flex items-center justify-between"
                      >
                        <span className="text-sm text-foreground">
                          {optionLabel}
                        </span>
                        <Switch
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            const currentValues = Array.isArray(
                              fieldState[f.key]
                            )
                              ? fieldState[f.key]
                              : f.default || [];
                            let newValues;
                            if (checked) {
                              newValues = [...currentValues, optionId];
                            } else {
                              newValues = currentValues.filter(
                                (v: string) => v !== optionId
                              );
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

              {/* --------- Toggle Field --------- */}
              {f.type === "toggle" && (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground">{f.label}</span>
                    {f.description && (
                      <span className="text-xs text-muted-foreground">
                        {f.description}
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={
                      typeof fieldState[f.key] === "boolean"
                        ? fieldState[f.key]
                        : !!f.default
                    }
                    onCheckedChange={(checked) => handleChange(f.key, checked)}
                  />
                </div>
              )}
            </div>
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
              const operatorDisplay =
                operatorField?.groupedOptions &&
                getOperatorDisplay(cond.operator, operatorField.groupedOptions);
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

                  <div className="flex items-center gap-2 p-2 border rounded bg-muted/10">
                    {/* Left */}
                    {leftField &&
                    leftField.options &&
                    leftField.options.length > 0 ? (
                      <Select
                        value={cond.left}
                        onValueChange={(v) => updateCondition(i, "left", v)}
                      >
                        <SelectTrigger className="flex-1 h-8 text-xs">
                          <SelectValue placeholder={leftField.placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                          {(leftField.options || []).map((opt: any) => (
                            <SelectItem
                              key={opt.id || opt.value}
                              value={opt.id || opt.value}
                            >
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
                        onChange={(e) =>
                          updateCondition(i, "left", e.target.value)
                        }
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(e) =>
                          handleRepeaterDrop(i, "left", e, cond.left || "")
                        }
                        style={
                          cond.left?.includes("{{") ? referenceStyle : undefined
                        }
                        onFocus={(e) => e.target.select()}
                      />
                    )}

                    {/* Operator */}
                    {operatorField && operatorField.groupedOptions ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-32 h-8 text-xs justify-between"
                          >
                            <span className="flex items-center gap-1">
                              <span className="text-primary font-medium">
                                {operatorDisplay?.icon ?? "?"}
                              </span>
                              {operatorDisplay?.label ?? operatorField.label}
                            </span>
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          {Object.entries(operatorField.groupedOptions).map(
                            ([typeKey, typeData]: [
                              string,
                              {
                                icon: string;
                                label: string;
                                options: { label: string; value: string }[];
                              }
                            ]) => (
                              <DropdownMenuSub key={typeKey}>
                                <DropdownMenuSubTrigger>
                                  <span className="text-primary mr-2">
                                    {typeData.icon}
                                  </span>
                                  {typeData.label}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-48">
                                  {typeData.options.map((opt) => (
                                    <DropdownMenuItem
                                      key={opt.value}
                                      onClick={() =>
                                        handleOperatorSelect(i, opt.value)
                                      }
                                      className={
                                        cond.operator === opt.value
                                          ? "bg-accent text-primary"
                                          : ""
                                      }
                                    >
                                      {opt.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      operatorField && (
                        <Select
                          value={cond.operator}
                          onValueChange={(v) => handleOperatorSelect(i, v)}
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
                      )
                    )}

                    {/* Right */}
                    {rightField && showRightField && (
                      <Input
                        className="flex-1 h-8 text-xs nodrag"
                        placeholder={rightField.placeholder || "Right value"}
                        value={cond.right || ""}
                        onChange={(e) =>
                          updateCondition(i, "right", e.target.value)
                        }
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(e) =>
                          handleRepeaterDrop(i, "right", e, cond.right || "")
                        }
                        style={
                          cond.right?.includes("{{")
                            ? referenceStyle
                            : undefined
                        }
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
                  {(cond.left?.includes("{{") ||
                    cond.right?.includes("{{")) && (
                    <div className="text-xs text-gray-500 space-y-1 ml-2">
                      {cond.left?.includes("{{") && (
                        <div>
                          Left preview: {getPreviewFor(i, "left", cond.left)}
                        </div>
                      )}
                      {cond.right?.includes("{{") && (
                        <div>
                          Right preview: {getPreviewFor(i, "right", cond.right)}
                        </div>
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
              {repeaterField?.key === "conditions"
                ? "Add Condition"
                : "Add Field"}
            </Button>

            {/* --------- LOGICAL OPERATOR (If nodes only, after conditions) --------- */}
            {isConditional &&
              conditions.length > 1 &&
              definition.fields?.map((f: any) => {
                if (f.key !== "logicalOp") return null;

                return (
                  <div key={f.key} className="mt-3">
                    <Label>{f.label}</Label>
                    <Select
                      value={fieldState[f.key] || f.default}
                      onValueChange={(val) => handleChange(f.key, val)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            f.placeholder || "Select logical operator"
                          }
                        />
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
              const caseOperatorDisplay = operatorSubField?.groupedOptions
                ? getOperatorDisplay(
                    caseItem.operator || "===",
                    operatorSubField.groupedOptions
                  )
                : null;
              const showRightField = operatorRequiresRightValue(
                caseItem.operator
              );

              return (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2 p-2 border rounded bg-muted/10">
                    <Input
                      className="flex-1 h-8 text-xs nodrag"
                      placeholder={leftField?.placeholder || "Left value"}
                      value={caseItem.left || ""}
                      onChange={(e) => updateCase(i, "left", e.target.value)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) =>
                        handleSwitchConditionDrop(
                          i,
                          "left",
                          e,
                          caseItem.left || ""
                        )
                      }
                      style={
                        caseItem.left?.includes("{{")
                          ? referenceStyle
                          : undefined
                      }
                      onFocus={(e) => e.target.select()}
                    />

                    {operatorSubField?.groupedOptions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            className="w-32 h-8 text-xs justify-between flex-shrink-0"
                          >
                            <span className="flex items-center gap-1">
                              <span className="text-primary font-medium">
                                {caseOperatorDisplay?.icon ?? "?"}
                              </span>
                              <span className="truncate">
                                {caseOperatorDisplay?.label ?? "is equal to"}
                              </span>
                            </span>
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          {Object.entries(operatorSubField.groupedOptions).map(
                            ([typeKey, typeData]: [
                              string,
                              {
                                icon: string;
                                label: string;
                                options: { label: string; value: string }[];
                              }
                            ]) => (
                              <DropdownMenuSub key={typeKey}>
                                <DropdownMenuSubTrigger>
                                  <span className="text-primary mr-2">
                                    {typeData.icon}
                                  </span>
                                  {typeData.label}
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent className="w-48">
                                  {typeData.options.map((opt) => (
                                    <DropdownMenuItem
                                      key={opt.value}
                                      onClick={() =>
                                        updateCase(i, "operator", opt.value)
                                      }
                                      className={
                                        caseItem.operator === opt.value
                                          ? "bg-accent text-primary"
                                          : ""
                                      }
                                    >
                                      {opt.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>
                            )
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}

                    {rightField && showRightField && (
                      <Input
                        className="flex-1 h-8 text-xs nodrag"
                        placeholder={rightField.placeholder || "Right value"}
                        value={caseItem.right ?? caseItem.caseValue ?? ""}
                        onChange={(e) => updateCase(i, "right", e.target.value)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(e) =>
                          handleSwitchConditionDrop(
                            i,
                            "right",
                            e,
                            caseItem.right || ""
                          )
                        }
                        style={
                          caseItem.right?.includes("{{")
                            ? referenceStyle
                            : undefined
                        }
                        onFocus={(e) => e.target.select()}
                      />
                    )}

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

                  {outputField && (
                    <div className="mt-2 pl-2">
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-44 h-8 text-xs nodrag"
                          placeholder={outputField.placeholder || "Output name"}
                          value={
                            caseItem.outputName ||
                            caseItem.caseName ||
                            caseItem.caseValue ||
                            ""
                          }
                          onChange={(e) =>
                            updateCase(i, "outputName", e.target.value)
                          }
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                    </div>
                  )}

                  {(caseItem.left?.includes("{{") ||
                    caseItem.right?.includes("{{")) && (
                    <div className="text-xs text-gray-500 space-y-1 ml-2">
                      {caseItem.left?.includes("{{") && (
                        <div>
                          Left preview: {getSwitchPreviewFor(caseItem.left)}
                        </div>
                      )}
                      {caseItem.right?.includes("{{") && (
                        <div>
                          Right preview: {getSwitchPreviewFor(caseItem.right)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {fallbackField && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex flex-col">
                  <span className="text-sm text-foreground">
                    {fallbackField.label}
                  </span>
                  {fallbackField.description && (
                    <span className="text-xs text-muted-foreground">
                      {fallbackField.description}
                    </span>
                  )}
                </div>
                <Switch
                  checked={
                    typeof fieldState[fallbackField.key] === "boolean"
                      ? fieldState[fallbackField.key]
                      : !!fallbackField.default
                  }
                  onCheckedChange={(checked) =>
                    handleChange(fallbackField.key, checked)
                  }
                />
              </div>
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
      <Suspense fallback={<div>Loading modal...</div>}>
        {!readOnly &&
          showAuth &&
          (definition.auth === "SchwabAuthModal" ? (
            <SchwabAuthModal
              isOpen={showAuth}
              onClose={() => {
                setShowAuth(false);
                (definition.fields || []).forEach((f: any) => {
                  if (
                    f.type === "select" &&
                    f.optionsSource === "credentialsApi"
                  ) {
                    fetchCredentials(f.key);
                  }
                });
              }}
              onSuccess={(credentialId) => {
                setShowAuth(false);
                (definition.fields || []).forEach((f: any) => {
                  if (
                    f.type === "select" &&
                    f.optionsSource === "credentialsApi"
                  ) {
                    fetchCredentials(f.key);
                  }
                });
              }}
              userId={user?.id || ""}
            />
          ) : (
            <GenericAuthModal
              definition={definition}
              onClose={() => {
                setShowAuth(false);
                (definition.fields || []).forEach((f: any) => {
                  if (
                    f.type === "select" &&
                    f.optionsSource === "credentialsApi"
                  ) {
                    fetchCredentials(f.key);
                  }
                });
              }}
            />
          ))}
      </Suspense>
    </>
  );
};

export default RepeaterNodeLayout;
