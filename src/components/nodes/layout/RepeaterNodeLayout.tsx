import { snapshotTypedExpressionContext, pickTypedJsonSource } from "../../../../coreza-backend/src/nodes/logic/typedExpressionContext";
import { TYPED_EXPRESSION_FEATURES } from "../../../../coreza-backend/src/nodes/logic/safeExpression";
import { useStableNodes } from "@/contexts/StableNodeContext";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Plus } from "lucide-react";
import type { BaseNodeRenderProps } from "../BaseNode";
import { useAuth } from "@/contexts/AuthContext";
import {
  useExecutionStore,
  useExecutionStoreVersion,
} from "@/contexts/ExecutionStoreContext";
import { resolveReferences } from "@/utils/resolveReferences";
import { fullePreview } from "@/utils/preview";
import { buildPreviewData } from "@/utils/previewDataResolver";
import { operatorRequiresRightValue } from "@/components/nodes/layout/utils/operators";
import NodeFieldRenderer from "@/components/nodes/layout/components/NodeFieldRenderer";
import {
  ReferenceDropTarget,
  referenceDropEventHandlers,
} from "@/components/nodes/layout/components/ReferenceDropTarget";
import LayoutAuthModal from "@/components/nodes/layout/components/LayoutAuthModal";
import VisualizeNodePreview from "@/components/nodes/visualize/VisualizeNodePreview";
import {
  compileEditTemplate,
  evaluateEditTemplate,
} from "../../../../coreza-backend/src/nodes/logic/editTemplate";
import {
  checkExpressionResult,
  editFieldValueType,
  EDIT_FIELD_DATA_TYPES,
  isEditFieldDataType,
} from "../../../../coreza-backend/src/nodes/logic/editFields";
import { pickJsonSource } from "../../../../coreza-backend/src/utils/referenceResolution";
import type { ReferenceNode } from "../../../../coreza-backend/src/utils/referenceResolution";
import {
  isTypedEditFieldRow,
  type TypedEditFieldRow,
} from "../../../../coreza-backend/src/nodes/logic/typedEditFieldRow";
import {
  buildNodeReference,
  parseJsonReferenceDragPayload,
} from "@/utils/referencePath";
import { useReferenceTextDrop, planReferenceTextDrop, finishReferenceTextDrop } from "@/hooks/useReferenceTextDrop";

interface EditFieldEditorProps {
  row: TypedEditFieldRow;
  index: number;
  disabled?: boolean;
  update: (index: number, field: string, value: unknown) => boolean | void;
  updateMany: (index: number, values: Record<string, unknown>) => boolean | void;
  remove: (index: number) => void;
  getExpressionContext: () => {
    input: unknown;
    nodes: Record<string, unknown>;
    expressionOutputs: Record<string, unknown>;
    definitions: ReferenceNode[];
    hasInput: boolean;
  };
  makeReference: (event: React.DragEvent) => string | null;
  canRemove: boolean;
}

export const EditFieldEditor: React.FC<EditFieldEditorProps> = ({
  row,
  index,
  disabled,
  update,
  updateMany,
  remove,
  getExpressionContext,
  makeReference,
  canRemove,
}) => {
  const value = String(row.value ?? "");
  const expression = row.valueMode === "expression";
  const [preview, setPreview] = useState<{
    value: string;
    type: string;
    typeError?: string;
    evaluationError?: string;
  }>({ value: "No data", type: "No data" });
  const [hasInput, setHasInput] = useState(false);
  const previewGeneration = useRef(0);
  useEffect(() => {
    const generation = ++previewGeneration.current;
    if (!expression) return () => undefined;
    const timer = window.setTimeout(() => {
      if (!value.trim()) {
        if (generation === previewGeneration.current)
          setPreview({ value: '""', type: "String" });
        return;
      }
      const context = getExpressionContext();
      if (generation !== previewGeneration.current) return;
      setHasInput(context.hasInput);
      try {
        const dataType = isEditFieldDataType(row.dataType)
          ? row.dataType
          : "string";
        const compiled = compileEditTemplate(value, TYPED_EXPRESSION_FEATURES);
        const result = evaluateEditTemplate(compiled, {
          $json: compiled.hasComputedSlices ? pickTypedJsonSource(context.input) : pickJsonSource(context.input),
          $nodes: context.nodes,
          expressionOutputs: context.expressionOutputs,
          nodes: context.definitions,
        });
        const rendered =
          typeof result === "string"
            ? JSON.stringify(result)
            : result === undefined
              ? "undefined"
              : JSON.stringify(result);
        let typeError: string | undefined;
        try {
          checkExpressionResult(result, dataType, String(row.fieldName ?? ""));
        } catch {
          typeError = `expected ${dataType[0].toUpperCase()}${dataType.slice(1)}`;
        }
        if (generation === previewGeneration.current)
          setPreview({
            value: rendered ?? String(result),
            type: editFieldValueType(result),
            typeError,
          });
      } catch (error) {
        if (generation === previewGeneration.current)
          setPreview({
            value: "Evaluation failed",
            type: "Error",
            evaluationError:
              error instanceof Error ? error.message : String(error),
          });
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [expression, getExpressionContext, row.dataType, row.fieldName, value]);
  const [dropError, setDropError] = useState<string>();
  const referenceDrop = useReferenceTextDrop({
    value, meta: row.valueMode,
    onChange: value => {
      setDropError(undefined); return update(index, "value", value);
    },
    onRestore: (value, mode) => updateMany(index, { value, valueMode: mode }),
    disabled,
  });
  const onDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    referenceDrop.clearCaret();
    try {
      const reference = makeReference(event);
      if (!reference) return;
      referenceDrop.bind(event);
      referenceDrop.clearCaret();
      if (disabled) return;
      const insertion = planReferenceTextDrop(event, reference, expression, true);
      if (!insertion) { setDropError("Place the reference in editable text or unquoted expression code. Repair partial delimiters first."); return; }
      if (updateMany(index, { value: insertion.value, valueMode: "expression" }) === false) return;
      finishReferenceTextDrop(event, insertion, "expression");
      setDropError(undefined);
    } finally {
      document.body.classList.remove("cursor-grabbing", "select-none");
    }
  };
  const editorClass =
    "nodrag w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  return (
    <div className="space-y-2 rounded border border-white/10 bg-white/[0.03] p-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <Label>Field Name</Label>
          <input
            className={editorClass}
            value={String(row.fieldName ?? "")}
            onChange={(e) => update(index, "fieldName", e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="w-32">
          <Label>Type</Label>
          <Select
            value={String(row.dataType ?? "string")}
            onValueChange={(dataType) =>
              updateMany(index, {
                dataType,
                ...(value === ""
                  ? { value: dataType === "boolean" ? "false" : "" }
                  : {}),
              })
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDIT_FIELD_DATA_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type[0].toUpperCase() + type.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="nodeIconGhost"
            size="icon"
            onClick={() => remove(index)}
            disabled={disabled}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div>
        <Label>Value Mode</Label>
        <div className="grid grid-cols-2 rounded-md bg-muted p-1">
          {["fixed", "expression"].map((mode) => (
            <button
              type="button"
              key={mode}
              disabled={disabled}
              onClick={() => {
                update(index, "valueMode", mode);
              }}
              className={`rounded px-2 py-1 text-xs ${row.valueMode === mode ? "bg-background shadow" : "text-muted-foreground"}`}
            >
              {mode === "fixed" ? "Fixed" : "Expression"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <ReferenceDropTarget onDrop={onDrop} onDragOver={referenceDrop.props.onDragOver} onDragLeave={referenceDrop.props.onDragLeave}>
          <Label>Value</Label>
          {!expression && row.dataType === "boolean" ? (
            <Select
              value={value || "false"}
              onValueChange={(v) => update(index, "value", v)}
              disabled={disabled}
            >
              <SelectTrigger {...referenceDropEventHandlers} onDrop={onDrop}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">true</SelectItem>
                <SelectItem value="false">false</SelectItem>
              </SelectContent>
            </Select>
          ) : expression ||
            row.dataType === "array" ||
            row.dataType === "object" ? (
            <textarea
              className={`${editorClass} min-h-20 ${expression ? "font-mono" : ""}`}
              value={value}
              {...referenceDrop.props}
              ref={referenceDrop.controlRef as React.MutableRefObject<HTMLTextAreaElement | null>}
              onDragEnter={referenceDropEventHandlers.onDragEnter}
              onDrop={onDrop}
              disabled={disabled}
            />
          ) : (
            <input
              className={editorClass}
              value={value}
              {...referenceDrop.props}
              ref={referenceDrop.controlRef as React.MutableRefObject<HTMLInputElement | null>}
              onDragEnter={referenceDropEventHandlers.onDragEnter}
              onDrop={onDrop}
              disabled={disabled}
            />
          )}
        </ReferenceDropTarget>
        {dropError && <p className="text-xs text-destructive">{dropError}</p>}
        {!expression &&
          (row.dataType === "array" || row.dataType === "object") &&
          value &&
          (() => {
            try {
              const parsed = JSON.parse(value);
              const valid =
                row.dataType === "array"
                  ? Array.isArray(parsed)
                  : parsed !== null &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed);
              return valid ? null : (
                <p className="text-xs text-destructive">
                  JSON must be a {String(row.dataType)}.
                </p>
              );
            } catch {
              return <p className="text-xs text-destructive">Invalid JSON.</p>;
            }
          })()}
      </div>
      {expression && (
        <div className="rounded bg-muted/50 p-2 text-xs">
          <strong>Result: </strong>
          <span className="font-mono">{preview.value}</span>
          <span> · {preview.type}</span>
          {preview.typeError && (
            <span className="text-destructive"> — {preview.typeError}</span>
          )}
          {preview.evaluationError && (
            <pre className="mt-1 whitespace-pre-wrap font-mono text-destructive">
              {preview.evaluationError}
            </pre>
          )}
          {!hasInput && (
            <p className="text-muted-foreground">
              Execute previous nodes to use input data
            </p>
          )}
        </div>
      )}
    </div>
  );
};
interface RepeaterNodeLayoutProps extends BaseNodeRenderProps {
  nodes?: any[];
  readOnly?: boolean;
}

const RepeaterNodeLayout: React.FC<RepeaterNodeLayoutProps> = ({
  definition,
  fieldState,
  loadingSelect,
  selectOptions,
  showAuth,
  handleChange,
  handleFieldStateBatch,
  handleSubmit,
  expandedExecutionControl,
  handleDrop,
  getFieldPreview,
  setShowAuth,
  fetchCredentials,
  fetchDependentOptions,
  referenceStyle,
  previousNodes,
  selectedPrevNodeId,
  selectedInputData,
  incomingEdgeCount,
  readOnly,
}) => {
  const { getNodes } = useStableNodes();
  const executionContext = useExecutionStore();
  const executionStoreVersion = useExecutionStoreVersion();
  const { user } = useAuth();

  // =========== DETERMINE REPEATER TYPE ===========
  const repeaterField = definition.fields?.find(
    (f: any) => f.type === "repeater",
  );
  const repeaterKey = repeaterField?.key;
  const isConditional = repeaterKey === "conditions";
  const isFieldRepeater = repeaterKey === "fields";
  const isOverlays = repeaterKey === "overlays";
  const isSwitch = repeaterKey === "cases";
  const fallbackField = useMemo(
    () => definition.fields?.find((f: any) => f.key === "enableFallback"),
    [definition.fields],
  );

  // =========== CONDITIONAL LOGIC ===========
  const defaultCond =
    Array.isArray(repeaterField?.default) && repeaterField.default.length > 0
      ? repeaterField.default[0]
      : (repeaterField?.default ?? { left: "", operator: "===", right: "" });

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
    [fieldState.logicalOps, isConditional],
  );

  const cases = useMemo(
    () => (Array.isArray(fieldState.cases) ? fieldState.cases : []),
    [fieldState.cases],
  );

  const casesRef = useRef(cases); casesRef.current = cases;
  const rowsRef = useRef(conditions); rowsRef.current = conditions;
  const liveReadOnly = useRef(readOnly); liveReadOnly.current = readOnly;

  // Row identities are transient: edits preserve them; document restore/removal rebases history.
  const rowKeys = useRef(new WeakMap<object, string>());
  const rowKey = (row: object) => {
    let key = rowKeys.current.get(row);
    if (!key) { key = crypto.randomUUID(); rowKeys.current.set(row, key); }
    return key;
  };
  const editedRow = (row: object, changes: Record<string, unknown>) => {
    const next = { ...row, ...changes };
    rowKeys.current.set(next, rowKey(row));
    return next;
  };

  const [sourceMap, setSourceMap] = useState<
    { left?: string; right?: string }[]
  >(conditions.map(() => ({})));

  const sourceMapRef = useRef(sourceMap); sourceMapRef.current = sourceMap;

  const overlays = useMemo(
    () => (Array.isArray(fieldState.overlays) ? fieldState.overlays : []),
    [fieldState.overlays],
  );

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
  }, [fieldState, handleFieldStateBatch, repeaterField]); // <- only on mount

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
        (_, i) => logicalOps[i] || "AND",
      );
      handleFieldStateBatch({ logicalOps: padded });
    }
  }, [
    isConditional,
    conditions.length,
    logicalOps.length,
    logicalOps,
    handleFieldStateBatch,
  ]);

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

  const createRepeaterRowId = () => {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    return `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  const addOverlay = () => {
    const defaultRow =
      repeaterField?.default && !Array.isArray(repeaterField.default)
        ? repeaterField.default
        : {};
    const newRow = { ...defaultRow, id: createRepeaterRowId() };
    handleFieldStateBatch({ overlays: [...overlays, newRow] });
  };

  const removeOverlay = (idx: number) => {
    handleFieldStateBatch({
      overlays: overlays.filter((_, rowIndex) => rowIndex !== idx),
    });
  };

  const updateOverlay = useCallback(
    (idx: number, key: string, val: unknown) => {
      return handleFieldStateBatch({
        overlays: overlays.map((row, rowIndex) =>
          rowIndex === idx
            ? { ...(row as Record<string, unknown>), [key]: val }
            : row,
        ),
      });
    },
    [handleFieldStateBatch, overlays],
  );

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
      Array.isArray(sm) ? sm.filter((_, i) => i !== idx) : [],
    );
  };

  const updateCondition = useCallback(
    (idx: number, field: string, value: any) => {
      const expected = conditions[idx];
      if (liveReadOnly.current || !expected) return false;
      const key = rowKey(expected);
      if (!rowsRef.current.some(row => rowKey(row) === key)) return false;
      return handleChange(repeaterKey!, rowsRef.current.map(row =>
        rowKey(row) === key ? editedRow(row, { [field]: value }) : row,
      ));
    },
    [conditions, handleChange, repeaterKey],
  );

  const updateFieldsRow = useCallback(
    (index: number, values: Record<string, unknown>) => {
      const expected = conditions[index];
      if (liveReadOnly.current || !expected) return false;
      const key = rowKey(expected);
      if (!rowsRef.current.some(row => rowKey(row) === key)) return false;
      return handleChange("fields", rowsRef.current.map(row =>
        rowKey(row) === key ? editedRow(row, values) : row,
      ));
    },
    [conditions, handleChange],
  );

  const handleOperatorSelect = useCallback(
    (idx: number, value: string, dataType?: string) => {
      handleChange(
        repeaterKey!,
        conditions.map((row, rowIdx) => {
          if (rowIdx !== idx) return row;
          const updated = {
            ...row,
            operator: value,
            dataType: dataType || "any",
          } as any;

          if (!operatorRequiresRightValue(value)) {
            updated.right = "";
          }

          return editedRow(row, updated);
        }),
      );
    },
    [conditions, handleChange, repeaterKey],
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
          logicalOps.map((v, i) => (i === idx ? op : v)),
        );
      }
    },
    [logicalOps, handleChange],
  );

  // =========== SWITCH HELPERS ===========
  const addCase = () => {
    const newIndex = cases.length + 1;
    handleChange("cases", [
      ...cases,
      {
        left: "",
        operator: "===",
        dataType: "any",
        right: "",
        outputName: `Case ${newIndex}`,
      },
    ]);
  };

  const removeCase = (idx: number) => {
    handleChange(
      "cases",
      cases.filter((_, i) => i !== idx),
    );
  };

  const updateCase = useCallback(
    (idx: number, field: string, value: string) => {
      const expected = cases[idx];
      if (liveReadOnly.current || !expected) return false;
      const key = rowKey(expected);
      if (!casesRef.current.some(row => rowKey(row) === key)) return false;
      return handleChange("cases", casesRef.current.map(row => rowKey(row) === key ? editedRow(row, { [field]: value }) : row));
    },
    [cases, handleChange],
  );

  const handleCaseOperatorSelect = useCallback(
    (idx: number, value: string, dataType?: string) => {
      handleChange(
        "cases",
        cases.map((row, rowIdx) => {
          if (rowIdx !== idx) return row;
          const updated = {
            ...row,
            operator: value,
            dataType: dataType || "any",
          } as any;

          if (!operatorRequiresRightValue(value)) {
            updated.right = "";
          }

          return updated;
        }),
      );
    },
    [cases, handleChange],
  );

  // =========== SHARED HELPERS ===========
  const resolveDeep = useCallback(
    (val: any, selectedInputData: any, allNodeData: Record<string, any>) => {
      const resolveValue = (value: any): any => {
        if (typeof value === "string") {
          const allNodes = getNodes();
          return resolveReferences(
            value,
            selectedInputData,
            allNodeData,
            allNodes,
          );
        }
        if (Array.isArray(value)) {
          return value.map(resolveValue);
        }
        if (typeof value === "object" && value !== null) {
          return Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [
              key,
              resolveValue(nested),
            ]),
          );
        }
        return value;
      };

      return resolveValue(val);
    },
    [getNodes],
  );

  const computeDropInsert = useCallback(
    (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData("application/reactflow");
      if (!raw) return null;

      try {
        const drag = parseJsonReferenceDragPayload(raw);
        if (!drag) return null;
        const sourceId = drag.sourceNodeId ?? selectedPrevNodeId;
        if (!sourceId) return null;
        const insert = buildNodeReference(drag, getNodes(), selectedPrevNodeId);
        if (!insert) return null;
        return {
          insert,
          sourceId,
        };
      } catch (error) {
        console.error("Drop error:", error);
        return null;
      }
    },
    [getNodes, selectedPrevNodeId],
  );

  const handleDropWithInsert = useCallback(
    (
      e: React.DragEvent,
      currentValue: string,
      onInsert: (insert: string, sourceId: string) => { beforeMeta?: unknown; meta?: unknown } | boolean | void,
    ) => {
      e.preventDefault();
      e.stopPropagation();

      const result = computeDropInsert(e);
      if (!result) {
        document.body.classList.remove("cursor-grabbing", "select-none");
        return;
      }

      const insertion = planReferenceTextDrop(e, result.insert);
      if (insertion) { const metadata = onInsert(insertion.value, result.sourceId); if (metadata !== false) finishReferenceTextDrop(e, insertion, typeof metadata === "object" ? metadata?.meta : undefined, typeof metadata === "object" ? metadata?.beforeMeta : undefined); }
      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [computeDropInsert],
  );

  // Drag helper for repeater (conditional)
  const handleRepeaterDrop = useCallback(
    (idx: number, field: string, e: React.DragEvent, currentValue: string) => {
      handleDropWithInsert(e, currentValue, (insert, sourceId) => {
        if (updateCondition(idx, field, insert) === false) return false;
        const beforeSource = sourceMapRef.current[idx]?.[field];
        const key = rowKey(conditions[idx]);
        const restoreSource = (source: string | undefined) => () => setSourceMap(sm => {
          const currentIndex = rowsRef.current.findIndex(row => rowKey(row) === key);
          if (currentIndex < 0) return sm;
          const next = [...sm], item = { ...next[currentIndex] }; if (source === undefined) delete item[field]; else item[field] = source; next[currentIndex] = item; return next;
        });

        setSourceMap((sm) => {
          const next = Array.isArray(sm) ? [...sm] : [];
          next[idx] = {
            ...(next[idx] || {}),
            [field]: sourceId,
          };
          return next;
        });
        return { beforeMeta: { restore: restoreSource(beforeSource) }, meta: { restore: restoreSource(sourceId) } };
      });
    },
    [handleDropWithInsert, updateCondition, conditions],
  );

  // Drag helper for switch
  const handleSwitchDrop = useCallback(
    (field: string, e: React.DragEvent, currentValue: string) => {
      handleDropWithInsert(e, currentValue, (insert) => {
        return handleChange(field, insert);
      });
    },
    [handleDropWithInsert, handleChange],
  );

  const handleSwitchConditionDrop = useCallback(
    (idx: number, field: string, e: React.DragEvent, currentValue: string) => {
      handleDropWithInsert(e, currentValue, (insert) => {
        return updateCase(idx, field, insert);
      });
    },
    [handleDropWithInsert, updateCase],
  );

  const getPreviewData = useCallback(
    () => buildPreviewData(previousNodes, executionContext, getNodes),
    [previousNodes, executionContext, getNodes, executionStoreVersion],
  );

  const getEditExpressionContext = useCallback(() => {
    const { allNodeData, getSourceData } = getPreviewData();
    const input = selectedInputData;
    const snapshot = snapshotTypedExpressionContext(getNodes(), id => executionContext.getNodeData(id).output);
    return {
      input,
      nodes: allNodeData,
      expressionOutputs: snapshot.nodeResults,
      definitions: snapshot.nodeIdentities,
      hasInput: input !== undefined,
    };
  }, [getPreviewData, getNodes, selectedInputData, executionContext]);

  const getOverlayPreviewFor = useCallback(
    (expr: unknown) => {
      if (typeof expr !== "string" || !expr.includes("{{")) return null;

      const { allNodeData, getSourceData } = getPreviewData();
      const srcData = getSourceData(selectedPrevNodeId);

      try {
        return fullePreview(
          resolveReferences(expr, srcData, allNodeData, getNodes()),
        );
      } catch (error) {
        return error instanceof Error ? error.message : "Reference preview failed.";
      }
    },
    [getPreviewData, selectedPrevNodeId, getNodes, executionStoreVersion],
  );

  const handleOverlayDrop = useCallback(
    (
      rowIndex: number,
      field: string,
      e: React.DragEvent,
      currentValue: string,
    ) => {
      handleDropWithInsert(e, currentValue, (insert) => {
        return updateOverlay(rowIndex, field, insert);
      });
    },
    [handleDropWithInsert, updateOverlay],
  );

  const visualizePreviewContext = useMemo(() => {
    const { allNodeData, getSourceData } = getPreviewData();
    return {
      allNodeData,
      nodes: getNodes(),
      sourceData: getSourceData(selectedPrevNodeId),
    };
  }, [getPreviewData, getNodes, selectedPrevNodeId, executionStoreVersion]);

  const getPreviewFor = useCallback(
    (idx: number, field: "left" | "right", expr: any) => {
      if (typeof expr !== "string" && typeof expr !== "object") return null;
      if (typeof expr === "string" && !expr.includes("{{")) return null;

      const srcId = sourceMap[idx]?.[field] || selectedPrevNodeId;
      const { allNodeData, getSourceData } = getPreviewData();
      const srcData = getSourceData(srcId);

      try {
        const resolved = resolveDeep(expr, srcData, allNodeData);
        return fullePreview(resolved);
      } catch (error) {
        console.error("❌ Preview resolution error:", error);
        return "";
      }
    },
    [
      selectedPrevNodeId,
      sourceMap,
      getPreviewData,
      resolveDeep,
      executionStoreVersion,
    ],
  );

  const getSwitchPreviewFor = useCallback(
    (expr: any) => {
      if (typeof expr !== "string" && typeof expr !== "object") return null;
      if (typeof expr === "string" && !expr.includes("{{")) return null;

      const { allNodeData, getSourceData } = getPreviewData();
      const srcData = getSourceData(selectedPrevNodeId);

      try {
        const resolved = resolveDeep(expr, srcData, allNodeData);
        return fullePreview(resolved);
      } catch (error) {
        console.error("❌ Preview resolution error:", error);
        return "";
      }
    },
    [selectedPrevNodeId, getPreviewData, resolveDeep, executionStoreVersion],
  );

  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {definition?.icon && (
            <img src={definition.icon} alt="icon" className="w-6 h-6" />
          )}
          <h2 className="font-semibold text-base text-foreground flex-1">
            {definition?.label || definition?.name || "Node"}
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
              onChange={(fieldKey, nextValue) => {
                if (
                  isFieldRepeater &&
                  fieldKey === "persistent" &&
                  nextValue === true &&
                  conditions.some(isTypedEditFieldRow)
                )
                  return;
                handleChange(fieldKey, nextValue);
              }}
              normalizeBlank
              onBatchChange={handleFieldStateBatch}
              onDrop={(fieldDef, e, currentValue) => {
                if (isSwitch) {
                  handleSwitchDrop(fieldDef.key, e, currentValue);
                } else {
                  handleDrop(
                    fieldDef.key,
                    (val: string) => handleChange(fieldDef.key, val),
                    e,
                    currentValue,
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
        {(isConditional || isFieldRepeater || isOverlays) && repeaterField && (
          <div className="space-y-3">
            <h4 className="font-semibold">
              {repeaterField?.key === "conditions" ||
              repeaterField?.type === "conditions"
                ? "Conditions"
                : isOverlays
                  ? "Overlays"
                  : "Fields"}
            </h4>

            {(isConditional || isFieldRepeater) &&
              conditions.map((cond, i) => {
                if (isFieldRepeater && isTypedEditFieldRow(cond)) {
                  return (
                    <EditFieldEditor
                      key={rowKey(cond)}
                      row={cond}
                      index={i}
                      disabled={readOnly}
                      canRemove={conditions.length > 1}
                      update={updateCondition}
                      updateMany={updateFieldsRow}
                      remove={removeCondition}
                      getExpressionContext={getEditExpressionContext}
                      makeReference={(event) =>
                        computeDropInsert(event)?.insert ?? null
                      }
                    />
                  );
                }
                const leftField = repeaterField.subFields?.find(
                  (sf: any) => sf.key === "left",
                );
                const operatorField = repeaterField.subFields?.find(
                  (sf: any) => sf.key === "operator",
                );
                const rightField = repeaterField.subFields?.find(
                  (sf: any) => sf.key === "right",
                );
                const persistentField = repeaterField.subFields?.find(
                  (sf: any) => sf.key === "persistent",
                );
                const showRightField = operatorRequiresRightValue(
                  cond.operator,
                );

                return (
                  <div key={rowKey(cond)} className="space-y-2">
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
                        <hr className="flex-1 border-t border-white/10" />
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-[1.5fr_auto_1.5fr_auto] gap-2 items-start p-2 border rounded bg-white/[0.03] border-white/10">
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
                            onChange={(key, val, dataType) =>
                              handleOperatorSelect(i, val, dataType)
                            }
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
                          getPreview={() =>
                            getPreviewFor(i, "right", cond.right)
                          }
                          referenceStyle={referenceStyle}
                          fetchDependentOptions={fetchDependentOptions}
                          setShowAuth={setShowAuth}
                          readOnly={readOnly}
                        />
                      )}

                      {conditions.length > 1 && (
                        <Button
                          type="button"
                          variant="nodeIconGhost"
                          size="icon"
                          onClick={() => removeCondition(i)}
                          className="h-7 w-7"
                          disabled={readOnly}
                        >
                          <X className="w-3.5 h-3.5" />
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

            {isOverlays &&
              overlays.map((overlayRow: any, rowIndex: number) => (
                <div
                  key={overlayRow?.id || rowIndex}
                  className="space-y-2 p-2 border rounded bg-white/[0.03] border-white/10"
                >
                  {repeaterField.subFields?.map((subField: any) => (
                    <NodeFieldRenderer
                      key={`${overlayRow?.id || rowIndex}-${subField.key}`}
                      field={subField}
                      definition={definition}
                      fieldState={{
                        ...fieldState,
                        [subField.key]: overlayRow?.[subField.key],
                      }}
                      value={overlayRow?.[subField.key]}
                      selectOptions={selectOptions}
                      loadingSelect={loadingSelect}
                      onChange={(key, val) => updateOverlay(rowIndex, key, val)}
                      onDrop={(fieldDef, e, currentValue) =>
                        handleOverlayDrop(
                          rowIndex,
                          fieldDef.key,
                          e,
                          currentValue,
                        )
                      }
                      getPreview={() =>
                        getOverlayPreviewFor(overlayRow?.[subField.key])
                      }
                      referenceStyle={referenceStyle}
                      fetchDependentOptions={fetchDependentOptions}
                      setShowAuth={setShowAuth}
                      readOnly={readOnly}
                    />
                  ))}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="nodeIconGhost"
                      size="icon"
                      onClick={() => removeOverlay(rowIndex)}
                      className="h-7 w-7"
                      disabled={readOnly}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}

            <Button
              type="button"
              variant="nodeAction"
              size="sm"
              onClick={isOverlays ? addOverlay : addCondition}
              className="flex items-center gap-2"
              disabled={readOnly}
            >
              <Plus className="w-3.5 h-3.5" />
              Add{" "}
              {isConditional ? "Condition" : isOverlays ? "Overlay" : "Field"}
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
                    normalizeBlank
                    referenceStyle={referenceStyle}
                    fetchDependentOptions={fetchDependentOptions}
                    setShowAuth={setShowAuth}
                    readOnly={readOnly}
                  />
                ) : null,
              )}
          </div>
        )}

        {/* --------- SWITCH REPEATER (Cases) --------- */}
        {isSwitch && (
          <div className="space-y-3">
            <h4 className="font-semibold">Cases</h4>

            {cases.map((caseItem, i) => {
              const leftField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "left",
              );
              const operatorSubField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "operator",
              );
              const rightField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "right",
              );
              const outputField = repeaterField?.subFields?.find(
                (sf: any) => sf.key === "outputName",
              );
              const showRightField = operatorRequiresRightValue(
                caseItem.operator,
              );

              return (
                <div key={rowKey(caseItem)} className="space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-[1.5fr_auto_1.5fr_auto] gap-2 items-start p-2 border rounded bg-white/[0.03] border-white/10">
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
                            currentValue,
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
                          onChange={(key, val, dataType) =>
                            handleCaseOperatorSelect(i, val, dataType)
                          }
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
                            currentValue,
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
                        variant="nodeIconGhost"
                        size="icon"
                        onClick={() => removeCase(i)}
                        className="h-7 w-7 flex-shrink-0"
                        disabled={readOnly}
                      >
                        <X className="w-3.5 h-3.5" />
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

            <Button
              type="button"
              variant="nodeAction"
              size="sm"
              onClick={addCase}
              className="flex items-center gap-2"
              disabled={readOnly}
            >
              <Plus className="w-3.5 h-3.5" />
              Add Case
            </Button>

            {fallbackField && (
              <NodeFieldRenderer
                field={fallbackField}
                definition={definition}
                fieldState={fieldState}
                value={fieldState[fallbackField.key]}
                selectOptions={selectOptions}
                loadingSelect={loadingSelect}
                onChange={(key, val) => handleChange(key, val)}
                normalizeBlank
                referenceStyle={referenceStyle}
                fetchDependentOptions={fetchDependentOptions}
                setShowAuth={setShowAuth}
                readOnly={readOnly}
              />
            )}
          </div>
        )}

        {definition?.name === "Visualize" && (
          <div className="pt-2 min-h-[340px] w-full">
            <VisualizeNodePreview
              fieldState={fieldState}
              sourceData={visualizePreviewContext.sourceData}
              allNodeData={visualizePreviewContext.allNodeData}
              nodes={visualizePreviewContext.nodes}
            />
          </div>
        )}

        {!readOnly && incomingEdgeCount >= 2 && (
          <div className="flex items-center justify-between pt-1">
            <Label
              htmlFor="check-dependency-repeater"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              Skip dependency check
            </Label>
            <Switch
              id="check-dependency-repeater"
              checked={Boolean(fieldState.checkDependency)}
              onCheckedChange={(checked) =>
                handleChange("checkDependency", checked)
              }
              disabled={readOnly}
            />
          </div>
        )}

        {expandedExecutionControl}
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
