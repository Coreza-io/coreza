import { useReferenceTextDrop, consumeReferenceFocusRestore, planReferenceTextDrop, finishReferenceTextDrop } from "@/hooks/useReferenceTextDrop";
import { useStableNodes } from "@/contexts/StableNodeContext";
import { buildNodeReference, parseJsonReferenceDragPayload } from "@/utils/referencePath";
import { FIELD_VALUE_MODES_KEY, getFieldValueMode, type FieldValueMode } from "../../../../../coreza-backend/src/utils/fieldValueModes";
import FieldValueModeSelector from "./FieldValueModeSelector";
import React from "react";
import { referenceDropEventHandlers } from "./ReferenceDropTarget";
import { useFieldPreview } from "@/hooks/useFieldPreview";
import { useVariableSnapshot } from "@/hooks/useVariableSnapshot";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldWrapper } from "./FieldWrapper";
import GroupedSelect from "./GroupedSelect";
import CredentialSelect from "./CredentialSelect";
import DependentSelect from "./DependentSelect";

interface NodeFieldRendererProps {
  field: any;
  definition: any;
  fieldState: Record<string, any>;
  value: any;
  selectOptions: Record<string, any[]>;
  loadingSelect: Record<string, boolean>;
  onChange: (fieldKey: string, value: any, dataType?: string) => boolean | void;
  normalizeBlank?: boolean;
  onBatchChange?: (updates: Record<string, any>) => boolean | void;
  onDrop?: (field: any, e: React.DragEvent, currentValue: string) => void;
  getPreview?: (fieldKey: string) => string | null;
  referenceStyle?: React.CSSProperties;
  fetchDependentOptions?: (field: any, parentValue: string) => void;
  setShowAuth?: (show: boolean) => void;
  workflowId?: string;
  nodeId?: string;
  userId?: string;
  readOnly?: boolean;
  selectedSourceNodeId?: string;
}

const NodeFieldRenderer: React.FC<NodeFieldRendererProps> = ({
  field,
  definition,
  fieldState,
  value,
  selectOptions,
  loadingSelect,
  onChange,
  normalizeBlank,
  onBatchChange,
  onDrop,
  getPreview,
  referenceStyle,
  fetchDependentOptions,
  setShowAuth,
  workflowId,
  nodeId,
  userId,
  readOnly,
  selectedSourceNodeId,
}) => {
  const { getNodes } = useStableNodes();
  const shouldShowDescription = field.showDescription !== false;
  const isHiddenField = field.type === "hidden";
  const matchesShowOptions = field.displayOptions?.show
    ? Object.entries(field.displayOptions.show).every(
        ([depKey, allowedValues]) => {
          const currentValue = fieldState[depKey];
          if (
            currentValue === undefined ||
            currentValue === null ||
            currentValue === ""
          ) {
            return false;
          }
          const values = Array.isArray(allowedValues)
            ? allowedValues
            : [allowedValues];
          if (Array.isArray(currentValue)) {
            return currentValue.some((v: string) => values.includes(v));
          }
          return values.includes(currentValue);
        },
      )
    : true;
  const matchesHideOptions = field.displayOptions?.hide
    ? !Object.entries(field.displayOptions.hide).some(
        ([depKey, allowedValues]) => {
          const currentValue = fieldState[depKey];
          const values = Array.isArray(allowedValues)
            ? allowedValues
            : [allowedValues];
          return values.some((v: any) => {
            const compareVal =
              typeof v === "object" && v !== null ? v.id || v.value : v;
            return String(currentValue) === String(compareVal);
          });
        },
      )
    : true;
  const shouldRender =
    !isHiddenField && matchesShowOptions && matchesHideOptions;

  let displayLabel = field.label;
  if (field.dynamicLabel?.dependsOn && field.dynamicLabel?.labelsByValue) {
    const dependentValue = fieldState[field.dynamicLabel.dependsOn];
    displayLabel =
      field.dynamicLabel.labelsByValue[dependentValue] || field.label;
  }

  const fieldValue = value ?? fieldState[field.key];
  const supportsValueMode = ["string", "number", "text", "textarea", "password"].includes(field.type)
    && !field.options?.length && !!onBatchChange;
  const valueMode = getFieldValueMode({ ...fieldState, [field.key]: fieldValue }, field.key);
  const variableQuery = useVariableSnapshot(!readOnly && supportsValueMode && valueMode === "expression", workflowId);
  const variableListId = React.useId();
  const updateValueMode = (mode: FieldValueMode, updates: Record<string, any> = {}) =>
    onBatchChange?.({
      ...updates,
      [FIELD_VALUE_MODES_KEY]: { ...fieldState[FIELD_VALUE_MODES_KEY], [field.key]: mode },
    });
  const isReference =
    (!supportsValueMode || valueMode === "expression") &&
    typeof fieldValue === "string" && fieldValue.includes("{{");
  const referencePreview =
    isReference && getPreview ? getPreview(field.key) : null;
  const fieldPreview = useFieldPreview(
    isReference && referencePreview !== null,
    referencePreview === "" ? '""' : referencePreview,
  );
  const multiselectValueMapDeps = React.useMemo(() => {
    if (field.type !== "multiselect") return "";
    const options = selectOptions[field.key] || field.options || [];
    const deps = options
      .filter((opt: any) => opt.valueMap?.field)
      .map((opt: any) => ({
        field: opt.valueMap.field,
        depValue: fieldState[opt.valueMap.field],
        optionId: opt.id || opt.value,
      }));
    return JSON.stringify(deps);
  }, [field.type, field.key, field.options, selectOptions, fieldState]);

  React.useEffect(() => {
    if (!shouldRender) return;
    if (field.type !== "multiselect") return;
    const options = selectOptions[field.key] || field.options || [];
    const valueMappedOpts = options.filter(
      (opt: any) => opt.valueMap?.field && opt.valueMap?.values,
    );
    if (valueMappedOpts.length === 0) return;

    const currentValues: string[] = Array.isArray(fieldValue)
      ? fieldValue
      : Array.isArray(field.default)
        ? field.default
        : [];
    if (currentValues.length === 0) return;

    let changed = false;
    let newValues = [...currentValues];

    for (const opt of valueMappedOpts) {
      const depValue = fieldState[opt.valueMap.field];
      if (!depValue) continue;
      const resolvedId = opt.valueMap.values[depValue] || opt.id || opt.value;
      const allMapped = [
        opt.id || opt.value,
        ...Object.values(opt.valueMap.values),
      ] as string[];
      const currentlySelected = allMapped.filter((v) => newValues.includes(v));
      if (
        currentlySelected.length > 0 &&
        !currentlySelected.includes(resolvedId)
      ) {
        newValues = newValues.filter((v) => !allMapped.includes(v));
        newValues.push(resolvedId);
        changed = true;
      }
    }

    if (changed) {
      onChange(field.key, newValues);
    }
  }, [
    field.type,
    field.key,
    field.options,
    field.default,
    fieldValue,
    selectOptions,
    fieldState,
    onChange,
    multiselectValueMapDeps,
    shouldRender,
  ]);

  const referenceDrop = useReferenceTextDrop({
    value: String(fieldValue ?? ""),
    onChange: value => onChange(field.key, value),
    normalizeValue: normalizeBlank ? value => value.trim() === "" ? "" : value : undefined,
    disabled: readOnly,
    identity: field.key,
    meta: supportsValueMode ? valueMode : undefined,
    onRestore: supportsValueMode
      ? (value, mode) => updateValueMode(mode as FieldValueMode, { [field.key]: value })
      : undefined,
  });

  const handleDropWrapper = (e: React.DragEvent) => {
    referenceDrop.clearCaret();
    if (!onDrop || readOnly) return;
    referenceDrop.bind(e);
    e.preventDefault();
    e.stopPropagation();
    if (supportsValueMode) {
      try {
        const data = parseJsonReferenceDragPayload(e.dataTransfer.getData("application/reactflow"));
        if (!data) return;
        const reference = buildNodeReference(data, getNodes(), selectedSourceNodeId);
        if (!reference) return;
        const insertion = planReferenceTextDrop(e, reference, valueMode === "expression", false);
        if (!insertion) return;
        if (updateValueMode("expression", { [field.key]: insertion.value }) === false) return;
        finishReferenceTextDrop(e, insertion, "expression", valueMode);
      } catch (error) {
        console.error("Reference drop failed:", error);
      } finally {
        document.body.classList.remove("cursor-grabbing", "select-none");
      }
      return;
    }
    onDrop(field, e, fieldValue || "");
  };

  const handleInputFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (!consumeReferenceFocusRestore(e.target)) e.target.select();
    if (isReference) {
      fieldPreview.open(e.currentTarget);
    }
  };

  const handleInputClick = (
    e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (isReference) {
      fieldPreview.open(e.currentTarget);
    }
  };

  const commonInputProps = {
    value: fieldValue ?? "",
    ref: referenceDrop.controlRef,
    ...referenceDrop.props,
    placeholder: field.placeholder,
    className: cn("nodrag", isReference && "font-mono text-xs"),
    style: undefined,
    "data-is-reference": isReference || undefined,
    onClick: handleInputClick,
    onFocus: handleInputFocus,
    onDragEnter: referenceDropEventHandlers.onDragEnter,
    onDrop: handleDropWrapper,
    readOnly,
  };

  if (!shouldRender) return null;

  const renderField = () => {
    switch (field.type) {
      case "webhookUrl": {
        const baseUrl =
          import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
        const provider =
          definition?.name === "WebhookTrigger"
            ? "generic"
            : definition?.name
              ? definition.name.replace("Trigger", "").toLowerCase()
              : "generic";
        const webhookUrl =
          workflowId && nodeId && userId
            ? `${baseUrl}/webhooks/${provider}/incoming/${userId}/${workflowId}/${nodeId}`
            : "Webhook URL will be available after saving the workflow";

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-1 text-xs font-semibold bg-primary/10 text-primary rounded">
                {fieldState.httpMethod || "POST"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={webhookUrl}
                readOnly
                className={cn("text-xs font-mono bg-muted rounded-xl")}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (webhookUrl && !webhookUrl.includes("will be available")) {
                    navigator.clipboard.writeText(webhookUrl);
                  }
                }}
                disabled={
                  !webhookUrl || webhookUrl.includes("will be available")
                }
              >
                Copy
              </Button>
            </div>
          </div>
        );
      }

      case "string":
      case "number":
      case "text":
      case "password": {
        const optionList = Array.isArray(field.options) ? field.options : null;

        if (optionList?.length) {
          const displayValue =
            fieldValue ??
            (typeof field.default === "string" ? field.default : "");

          return (
            <Select
              value={displayValue}
              onValueChange={(val) => onChange(field.key, val)}
              disabled={readOnly}
            >
              <SelectTrigger className={cn("w-full nodrag")}>
                <SelectValue
                  placeholder={field.placeholder || "Select option"}
                />
              </SelectTrigger>
              <SelectContent>
                {optionList.map((opt: any) => (
                  <SelectItem key={opt.value ?? opt.label} value={opt.value}>
                    {opt.label ?? opt.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }

        return (
          <div
            className="nodrag"
            onDragEnter={referenceDropEventHandlers.onDragEnter}
            onDragOver={referenceDrop.props.onDragOver}
            onDragLeave={referenceDrop.props.onDragLeave}
            onDrop={handleDropWrapper}
            ref={fieldPreview.wrapperRef}
          >
            <Input
              {...commonInputProps}
              list={valueMode === "expression" ? variableListId : undefined}
              ref={referenceDrop.controlRef as React.MutableRefObject<HTMLInputElement | null>}
              type={
                field.type === "number"
                  ? valueMode === "expression" || (typeof fieldValue === "string" && fieldValue.includes("{{")) ? "text" : "number"
                  : field.type === "password"
                    ? "password"
                    : undefined
              }
            />
            {!readOnly && valueMode === "expression" && <datalist id={variableListId}>{variableQuery.data?.entries.map(entry => <option key={entry.key} value={`{{ $vars.${entry.key} }}`} />)}</datalist>}
            {referenceDrop.error && <p role="status" className="text-xs text-destructive">{referenceDrop.error}</p>}
            {fieldPreview.popup}
          </div>
        );
      }

      case "textarea":
        return (
          <div
            className="nodrag"
            onDragEnter={referenceDropEventHandlers.onDragEnter}
            onDragOver={referenceDrop.props.onDragOver}
            onDragLeave={referenceDrop.props.onDragLeave}
            onDrop={handleDropWrapper}
            ref={fieldPreview.wrapperRef}
          >
            <textarea
              {...commonInputProps}
              ref={referenceDrop.controlRef as React.MutableRefObject<HTMLTextAreaElement | null>}
              className={cn(
                "w-full border border-input bg-background text-foreground placeholder:text-muted-foreground p-2 text-sm min-h-[100px] nodrag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
            {referenceDrop.error && <p role="status" className="text-xs text-destructive">{referenceDrop.error}</p>}
            {fieldPreview.popup}
          </div>
        );

      case "select": {
        if (field.optionsSource === "credentialsApi") {
          return (
            <CredentialSelect
              value={fieldValue}
              onChange={(val) => onChange(field.key, val)}
              options={selectOptions[field.key] || []}
              isLoading={loadingSelect[field.key]}
              onAddCredential={() => setShowAuth?.(true)}
              onCredentialChanged={(val) => {
                const dependentApiFields = definition.fields?.filter(
                  (f: any) =>
                    f.dependsOn === field.key &&
                    f.optionsSource === "dependentApi",
                );
                dependentApiFields?.forEach((depField: any) => {
                  fetchDependentOptions?.(depField, val);
                });
              }}
              disabled={readOnly}
            />
          );
        }

        if (field.optionsSource === "dependentApi") {
          return (
            <DependentSelect
              value={fieldValue}
              onChange={(val) => onChange(field.key, val)}
              options={selectOptions[field.key] || []}
              parentValue={fieldState[field.dependsOn]}
              isLoading={loadingSelect[field.key]}
              dependsOn={field.dependsOn}
              placeholder={field.placeholder}
              emptyLabel={
                !fieldState[field.dependsOn]
                  ? "Select credential first"
                  : "No accounts found"
              }
              disabled={readOnly}
            />
          );
        }

        if (field.optionsSource === "storeWorkflowsApi") {
          const options = selectOptions[field.key] || [];
          const isLoading = loadingSelect[field.key];

          return (
            <Select
              value={fieldValue || undefined}
              onValueChange={(val) => {
                const updates: Record<string, any> = { [field.key]: val };
                const variableFields = definition.fields?.filter(
                  (f: any) =>
                    f.optionsSource === "storeVariablesApi" &&
                    f.dependsOn === field.key,
                );
                variableFields?.forEach((varField: any) => {
                  updates[varField.key] = "";
                });
                if (onBatchChange) {
                  onBatchChange(updates);
                } else {
                  Object.entries(updates).forEach(([k, v]) => onChange(k, v));
                }
              }}
              disabled={isLoading || readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isLoading
                      ? "Loading workflows..."
                      : field.placeholder || "Select workflow"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {isLoading ? (
                  <SelectItem value="loading" disabled>
                    Loading...
                  </SelectItem>
                ) : options.length === 0 ? (
                  <SelectItem value="no-workflows" disabled>
                    No workflows found
                  </SelectItem>
                ) : (
                  options.map((workflow: any) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          );
        }

        if (field.optionsSource === "storeVariablesApi") {
          const hasParentValue = Boolean(fieldState[field.dependsOn]);

          return (
            <Select
              value={fieldValue || undefined}
              onValueChange={(val) => onChange(field.key, val)}
              disabled={loadingSelect[field.key] || !hasParentValue || readOnly}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    !hasParentValue
                      ? "Select workflow first"
                      : loadingSelect[field.key]
                        ? "Loading variables..."
                        : field.placeholder || "Select variable"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(selectOptions[field.key] || []).length > 0 ? (
                  selectOptions[field.key].map((variable: any) => (
                    <SelectItem key={variable.id} value={variable.id}>
                      {variable.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-variables" disabled>
                    {!hasParentValue
                      ? "Select workflow first"
                      : loadingSelect[field.key]
                        ? "Loading..."
                        : "No variables found"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          );
        }

        let displayOptions: any[] = [];
        if (
          field.dynamicOptions?.dependsOn &&
          field.dynamicOptions?.optionsByValue
        ) {
          const parentValue = fieldState[field.dynamicOptions.dependsOn];
          displayOptions =
            field.dynamicOptions.optionsByValue[parentValue] ??
            (field.dynamicOptions.fallbackToStatic ? field.options || [] : []);
        } else if (field.dependsOn && field.conditionalOptions) {
          const parentValue = fieldState[field.dependsOn];
          displayOptions = field.conditionalOptions[parentValue] || [];
        } else {
          displayOptions = selectOptions[field.key] || field.options || [];
        }

        return (
          <Select
            value={fieldValue}
            onValueChange={(val) => {
              onChange(field.key, val);
              if (field.conditionalOptions) {
                const dependentFields = definition.fields?.filter(
                  (f: any) => f.dependsOn === field.key,
                );
                dependentFields?.forEach((depField: any) => {
                  onChange(depField.key, "");
                });
              }
              const dependentApiFields = definition.fields?.filter(
                (f: any) =>
                  f.dependsOn === field.key &&
                  f.optionsSource === "dependentApi",
              );
              dependentApiFields?.forEach((depField: any) => {
                fetchDependentOptions?.(depField, val);
              });

              // Generic option-swap: when this select changes, walk other multiselect
              // fields whose options use displayOptions.show[field.key] and rewrite
              // selected ids that are now hidden, swapping via opt.swapTo when defined.
              const multiselectFields = definition.fields?.filter(
                (f: any) =>
                  f.type === "multiselect" &&
                  Array.isArray(f.options) &&
                  f.options.some(
                    (o: any) => o?.displayOptions?.show?.[field.key],
                  ),
              );
              multiselectFields?.forEach((msField: any) => {
                const current: string[] = Array.isArray(fieldState[msField.key])
                  ? fieldState[msField.key]
                  : [];
                if (!current.length && !msField.default) return;
                const optionsById: Record<string, any> = {};
                msField.options.forEach((o: any) => {
                  optionsById[o.id ?? o.value] = o;
                });
                const next: string[] = [];
                let changed = false;
                current.forEach((id) => {
                  const opt = optionsById[id];
                  const allowed = opt?.displayOptions?.show?.[field.key];
                  if (!allowed || allowed.includes(val)) {
                    next.push(id);
                    return;
                  }
                  changed = true;
                  const swap = opt?.swapTo?.[field.key]?.[val];
                  if (swap && !next.includes(swap)) next.push(swap);
                });
                if (!next.length && Array.isArray(msField.default)) {
                  msField.default.forEach((d: string) => {
                    if (!next.includes(d)) next.push(d);
                  });
                  changed = true;
                }
                if (changed) onChange(msField.key, next);
              });
            }}
            disabled={readOnly}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={field.placeholder || "Select option"} />
            </SelectTrigger>
            <SelectContent>
              {displayOptions.map((opt: any) => (
                <SelectItem
                  key={opt.id || opt.value}
                  value={opt.id || opt.value}
                >
                  {opt.name || opt.label || opt.id || opt.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "grouped-select":
        return (
          <GroupedSelect
            value={fieldValue || field.default || ""}
            groupedOptions={field.groupedOptions}
            onChange={(val, dataType) => onChange(field.key, val, dataType)}
            placeholder={field.placeholder}
            disabled={readOnly}
          />
        );

      case "checkbox":
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">{field.label}</span>
            <Switch
              checked={!!fieldValue}
              onCheckedChange={(checked) => onChange(field.key, checked)}
              disabled={readOnly}
            />
          </div>
        );

      case "toggle":
        return (
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-sm text-foreground">{field.label}</span>
            </div>
            <Switch
              checked={
                typeof fieldValue === "boolean" ? fieldValue : !!field.default
              }
              onCheckedChange={(checked) => onChange(field.key, checked)}
              disabled={readOnly}
            />
          </div>
        );

      case "multiselect": {
        const selectedValues = Array.isArray(fieldValue)
          ? fieldValue
          : field.default || [];
        const availableOptions =
          selectOptions[field.key] || field.options || [];

        // Helper: resolve the actual value for an option based on valueMap
        const resolveOptionId = (opt: any): string => {
          const baseId = opt.id || opt.value;
          if (opt.valueMap?.field && opt.valueMap?.values) {
            const depValue = fieldState[opt.valueMap.field];
            if (depValue && opt.valueMap.values[depValue]) {
              return opt.valueMap.values[depValue];
            }
          }
          return baseId;
        };

        // Helper: get all possible mapped values for an option (for removal)
        const getAllMappedValues = (opt: any): string[] => {
          const baseId = opt.id || opt.value;
          if (opt.valueMap?.values) {
            return [baseId, ...Object.values(opt.valueMap.values)] as string[];
          }
          return [baseId];
        };

        // Helper: check if option is selected (check all mapped values)
        const isOptionSelected = (opt: any): boolean => {
          const allValues = getAllMappedValues(opt);
          return allValues.some((v) => selectedValues.includes(v));
        };

        // Filter options by per-option displayOptions
        const visibleOptions = availableOptions.filter((opt: any) => {
          if (!opt.displayOptions?.show) return true;
          return Object.entries(opt.displayOptions.show).every(
            ([depKey, rawAllowed]: [string, any]) => {
              const current = fieldState[depKey];
              const allowed = Array.isArray(rawAllowed)
                ? rawAllowed
                : [rawAllowed];
              if (Array.isArray(current)) {
                return current.some((v: any) => allowed.includes(v));
              }
              return allowed.includes(current);
            },
          );
        });

        return (
          <div className="space-y-3">
            {visibleOptions.map((opt: any) => {
              const optionId = opt.id || opt.value;
              const optionLabel = opt.name || opt.label || opt.id || opt.value;
              const isSelected = isOptionSelected(opt);

              return (
                <div
                  key={optionId}
                  className="flex items-center justify-between"
                >
                  <span className="text-sm text-foreground">{optionLabel}</span>
                  <Switch
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      const currentValues = Array.isArray(fieldValue)
                        ? fieldValue
                        : field.default || [];
                      if (checked) {
                        const resolvedId = resolveOptionId(opt);
                        // Remove any stale mapped values first, then add resolved
                        const allMapped = getAllMappedValues(opt);
                        const cleaned = currentValues.filter(
                          (v: string) => !allMapped.includes(v),
                        );
                        onChange(field.key, [...cleaned, resolvedId]);
                      } else {
                        // Remove all possible mapped values
                        const allMapped = getAllMappedValues(opt);
                        const newValues = currentValues.filter(
                          (v: string) => !allMapped.includes(v),
                        );
                        onChange(field.key, newValues);
                      }
                    }}
                    disabled={readOnly}
                  />
                </div>
              );
            })}
          </div>
        );
      }

      case "tabs": {
        const tabs = field.tabs || [];
        const currentTab = fieldValue || field.default || tabs[0]?.id || "";

        return (
          <Tabs
            value={currentTab}
            onValueChange={(val) => onChange(field.key, val)}
            className="w-full nodrag"
          >
            <TabsList className="w-full">
              {tabs.map((tab: { id: string; label: string }) => (
                <TabsTrigger key={tab.id} value={tab.id} className="flex-1">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        );
      }

      default:
        return null;
    }
  };

  return (
    <FieldWrapper
      key={field.key}
      label={
        field.type === "checkbox" || field.type === "toggle"
          ? undefined
          : displayLabel
      }
      hideLabel={field.type === "checkbox" || field.type === "toggle"}
      className={supportsValueMode ? "group/value-mode nodrag" : undefined}
      labelAction={supportsValueMode ? (
        <FieldValueModeSelector
          label={String(displayLabel || field.key)}
          value={valueMode}
          disabled={readOnly}
          onChange={updateValueMode}
        />
      ) : undefined}
      description={undefined}
    >
      {renderField()}
    </FieldWrapper>
  );
};

export default NodeFieldRenderer;
