import React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const glassInput =
  "rounded-xl transition-all duration-200 " +
  "dark:bg-white/[0.03] dark:border-white/10 dark:text-blue-100 " +
  "dark:placeholder:text-white/20 dark:focus-visible:border-blue-500/50 " +
  "dark:focus-visible:ring-4 dark:focus-visible:ring-blue-500/10";

const glassLabelClass =
  "dark:text-[11px] dark:font-bold dark:uppercase dark:tracking-wider dark:text-slate-400";
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
  onChange: (fieldKey: string, value: any, dataType?: string) => void;
  onBatchChange?: (updates: Record<string, any>) => void;
  onDrop?: (field: any, e: React.DragEvent, currentValue: string) => void;
  getPreview?: (fieldKey: string) => string | null;
  referenceStyle?: React.CSSProperties;
  fetchDependentOptions?: (field: any, parentValue: string) => void;
  setShowAuth?: (show: boolean) => void;
  workflowId?: string;
  nodeId?: string;
  userId?: string;
  readOnly?: boolean;
}

const NodeFieldRenderer: React.FC<NodeFieldRendererProps> = ({
  field,
  definition,
  fieldState,
  value,
  selectOptions,
  loadingSelect,
  onChange,
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
}) => {
  const [showFloatingPreview, setShowFloatingPreview] = React.useState(false);
  const [previewAnchorRect, setPreviewAnchorRect] =
    React.useState<DOMRect | null>(null);
  const fieldWrapperRef = React.useRef<HTMLDivElement | null>(null);
  const previewCardRef = React.useRef<HTMLDivElement | null>(null);
  const activeElementRef = React.useRef<HTMLElement | null>(null);
  const shouldShowDescription = field.showDescription !== false;
  const isHiddenField = field.type === "hidden";
  const matchesShowOptions = field.displayOptions?.show
    ? Object.entries(field.displayOptions.show).every(
        ([depKey, allowedValues]) => {
          const currentValue = fieldState[depKey];
          if (!currentValue) return false;
          if (Array.isArray(currentValue)) {
            return currentValue.some((v: string) =>
              (allowedValues as string[]).includes(v),
            );
          }
          return (allowedValues as string[]).includes(currentValue);
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
  const isReference =
    typeof fieldValue === "string" && fieldValue.includes("{{");
  const referencePreview =
    isReference && getPreview ? getPreview(field.key) : null;
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

  const handleDropWrapper = (e: React.DragEvent) => {
    if (!onDrop) return;
    e.preventDefault();
    e.stopPropagation();
    onDrop(field, e, fieldValue || "");
  };

  const openFloatingPreview = (target: HTMLElement) => {
    if (!referencePreview) return;
    activeElementRef.current = target;
    setPreviewAnchorRect(target.getBoundingClientRect());
    setShowFloatingPreview(true);
  };

  const handleInputFocus = (
    e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    e.target.select();
    if (isReference) {
      openFloatingPreview(e.currentTarget);
    }
  };

  const handleInputClick = (
    e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (isReference) {
      openFloatingPreview(e.currentTarget);
    }
  };

  const commonInputProps = {
    value: fieldValue ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(field.key, e.target.value),
    placeholder: field.placeholder,
    className: cn("nodrag", glassInput, isReference && "font-mono text-xs truncate"),
    style: isReference ? referenceStyle : undefined,
    onClick: handleInputClick,
    onFocus: handleInputFocus,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: handleDropWrapper,
    disabled: readOnly,
  };

  React.useEffect(() => {
    if (!showFloatingPreview) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (previewCardRef.current?.contains(target)) return;
      if (fieldWrapperRef.current?.contains(target)) return;
      setShowFloatingPreview(false);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showFloatingPreview]);

  React.useEffect(() => {
    if (!showFloatingPreview) return;

    const updatePosition = () => {
      if (activeElementRef.current) {
        setPreviewAnchorRect(activeElementRef.current.getBoundingClientRect());
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showFloatingPreview]);

  React.useEffect(() => {
    if (!isReference || !referencePreview) {
      setShowFloatingPreview(false);
    }
  }, [isReference, referencePreview]);

  if (!shouldRender) return null;

  const renderPreviewCard = () => {
    if (!referencePreview || !showFloatingPreview || !previewAnchorRect)
      return null;

    const availableWidth = window.innerWidth - 16;
    const width = Math.min(
      Math.max(previewAnchorRect.width, 260),
      availableWidth,
    );
    const left = Math.min(
      Math.max(8, previewAnchorRect.left),
      availableWidth - width + 8,
    );

    return createPortal(
      <div
        ref={previewCardRef}
        style={{
          position: "fixed",
          top: previewAnchorRect.top,
          left,
          width,
          transform: "translateY(calc(-100% - 8px))",
          zIndex: 50,
        }}
        className="pointer-events-auto"
      >
        <div className="rounded-lg border bg-card text-card-foreground shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/60">
            <span className="text-xs font-medium text-muted-foreground">
              Result
            </span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              Preview
            </span>
          </div>
          <div className="px-3 py-2 text-sm break-words whitespace-pre-wrap max-h-40 overflow-auto font-mono bg-background">
            {referencePreview}
          </div>
          <div className="px-3 py-2 bg-muted/50 text-[11px] text-muted-foreground flex items-center gap-1">
            <span className="font-semibold text-foreground">Tip:</span>
            <span>Anything inside {"{{ }}"} is JavaScript.</span>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

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
                className={cn("text-xs font-mono bg-muted rounded-xl", "dark:bg-white/[0.05] dark:border-white/10 dark:text-blue-100")}
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
              <SelectTrigger className={cn("w-full nodrag", glassInput, "dark:text-white")}>
                <SelectValue
                  placeholder={field.placeholder || "Select option"}
                />
              </SelectTrigger>
              <SelectContent className="dark:bg-popover dark:border-white/10">
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
            onDragOver={commonInputProps.onDragOver}
            onDrop={handleDropWrapper}
            ref={fieldWrapperRef}
          >
            <Input
              {...commonInputProps}
              type={
                field.type === "number"
                  ? "number"
                  : field.type === "password"
                    ? "password"
                    : undefined
              }
            />
            {renderPreviewCard()}
          </div>
        );
      }

      case "textarea":
        return (
          <div
            className="nodrag"
            onDragOver={commonInputProps.onDragOver}
            onDrop={handleDropWrapper}
            ref={fieldWrapperRef}
          >
            <textarea
              {...commonInputProps}
              className={cn("w-full border border-input bg-background text-foreground placeholder:text-muted-foreground p-2 text-sm min-h-[100px] nodrag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", glassInput)}
            />
            {renderPreviewCard()}
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
            field.dynamicOptions.optionsByValue[parentValue] || [];
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
        field.type === "checkbox" || field.type === "toggle" ? undefined : (
          <span className={glassLabelClass}>{displayLabel}</span>
        )
      }
      hideLabel={field.type === "checkbox" || field.type === "toggle"}
      description={undefined}
    >
      {renderField()}
    </FieldWrapper>
  );
};

export default NodeFieldRenderer;
