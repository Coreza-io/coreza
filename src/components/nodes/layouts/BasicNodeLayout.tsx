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

import React, { Suspense, useMemo, memo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import { SchwabAuthModal } from "@/components/auth/SchwabAuthModal";
import { GmailAuthModal } from "@/components/auth/GmailAuthModal";
import VisualizeCandlesSignals from "@/components/charts/VisualizeCandlesSignals";
import { useAuth } from "@/contexts/AuthContext";
import { IconRegistry } from "@/components/icons/NodeIcons";
import CachedIcon from "@/components/common/CachedIcon";
import type { BaseNodeRenderProps } from "../BaseNode";

interface BasicNodeLayoutProps extends BaseNodeRenderProps {
  definition: any;
  fieldState: Record<string, any>;
  error: string;
  isSending: boolean;
  loadingSelect: Record<string, boolean>;
  selectOptions: Record<string, any[]>;
  showAuth: boolean;
  selectedInputData: any;
  workflowId?: string;
  nodeId?: string;
  handleChange: (key: string, value: any) => void;
  handleFieldStateBatch: (updates: Record<string, any>) => void;
  handleSubmit: (e?: React.FormEvent) => void;
  handleDrop: (fieldKey: string, setter: React.Dispatch<React.SetStateAction<string>>, e: React.DragEvent, currentValue: string) => void;
  getFieldPreview: (fieldKey: string) => string | null;
  setShowAuth: (show: boolean) => void;
  fetchCredentials: (fieldKey: string) => void;
  fetchDependentOptions: (field: any, parentValue: string) => void;
  referenceStyle: React.CSSProperties;
}

const BasicNodeLayout: React.FC<BasicNodeLayoutProps> = ({
  definition,
  fieldState,
  error,
  isSending,
  loadingSelect,
  selectOptions,
  showAuth,
  selectedInputData,
  workflowId,
  nodeId,
  handleChange,
  handleFieldStateBatch,
  handleSubmit,
  handleDrop,
  getFieldPreview,
  setShowAuth,
  fetchCredentials,
  fetchDependentOptions,
  referenceStyle,
}) => {
  const { user } = useAuth();
  const isVisualize = definition?.name === "Visualize";
  
  // Memoized visualization data processing
  const { vizCandles, filteredIndicator } = useMemo(() => {
    if (!isVisualize || !selectedInputData) return { vizCandles: null, filteredIndicator: [] };

    const toDictOfArrays = (candlesArray: any) => {
      if (!Array.isArray(candlesArray)) return candlesArray;
      return candlesArray.reduce((acc, c) => {
        acc.t.push(c.t ? c.t.slice(0, 10) : undefined);
        acc.o.push(c.o);
        acc.h.push(c.h);
        acc.l.push(c.l);
        acc.c.push(c.c);
        acc.v.push(c.v);
        return acc;
      }, { t: [], o: [], h: [], l: [], c: [], v: [] });
    };

    const firstInput = Array.isArray(selectedInputData) 
      ? selectedInputData[0] 
      : selectedInputData;

    let vizCandles = null;
    let vizIndicator = null;

    if (Array.isArray(firstInput?.candles)) {
      vizCandles = toDictOfArrays(firstInput.candles);
    } else if (firstInput?.candles && typeof firstInput.candles === 'object') {
      vizCandles = firstInput.candles;
    } else if (Array.isArray(firstInput)) {
      vizCandles = toDictOfArrays(firstInput);
    }
    
    if (firstInput?.indicator) {
      vizIndicator = firstInput.indicator;
    }

    const filteredIndicator = Array.isArray(vizIndicator)
      ? vizIndicator.filter((d: any) => d && d.value !== null && !isNaN(d.value))
      : [];

    return { vizCandles, filteredIndicator };
  }, [isVisualize, selectedInputData]);

  // Field rendering helper
  const renderField = (f: any) => {
    // Skip hidden fields
    if (f.type === "hidden") {
      return null;
    }

    // Conditional field display logic
    if (f.displayOptions?.show) {
    
      const shouldShow = Object.entries(f.displayOptions.show).every(
        ([depKey, allowedValues]) => {
          const currentValue = fieldState[depKey];
          //console.log(`Checking field ${f.key}: dependency ${depKey} = "${currentValue}", allowed values:`, allowedValues);
          // If the dependency field is empty/undefined, don't show this field
          if (!currentValue) {
            //console.log(`Field ${f.key} hidden: dependency ${depKey} is empty`);
            return false;
          }
          const isAllowed = (allowedValues as string[]).includes(currentValue);
          //console.log(`Field ${f.key}: ${currentValue} is allowed = ${isAllowed}`);
          return isAllowed;
        }
      );
      if (!shouldShow) {
        //console.log(`Field ${f.key} will be hidden`);
        return null;
      }
      //console.log(`Field ${f.key} will be shown`);
    }

    const fieldValue = fieldState[f.key];
    const isReference = typeof fieldValue === "string" && fieldValue.includes("{{");

    const commonInputProps = {
      value: fieldValue ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        handleChange(f.key, e.target.value),
      placeholder: f.placeholder,
      className: "nodrag",
      style: isReference ? referenceStyle : undefined,
      onDragOver: (e: React.DragEvent) => {
        //console.log("🔄 DRAG OVER input field:", f.key);
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      },
      onDrop: (e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        //console.log("💧 DROP EVENT on input field:", f.key);
        e.preventDefault();
        e.stopPropagation();
        
        //console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
        //console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
        
        // Just call the handleDrop function directly - no additional logic needed
        handleDrop(
          f.key,
          (val: string) => handleChange(f.key, val),
          e,
          fieldState[f.key] || ""
        );
      },
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.target.select();
      }
    };

    switch (f.type) {
      case "webhookUrl":
        // Generate the webhook URL
        const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
        const webhookUrl = workflowId && nodeId && user?.id
          ? `${baseUrl}/webhooks/incoming/${user.id}/${workflowId}/${nodeId}`
          : 'Webhook URL will be available after saving the workflow';
        
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-1 text-xs font-semibold bg-primary/10 text-primary rounded">
                {fieldState.httpMethod || 'POST'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Input 
                value={webhookUrl}
                readOnly
                className="text-xs font-mono bg-muted"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (webhookUrl && !webhookUrl.includes('will be available')) {
                    navigator.clipboard.writeText(webhookUrl);
                  }
                }}
                disabled={!webhookUrl || webhookUrl.includes('will be available')}
              >
                Copy
              </Button>
            </div>
          </div>
        );
      
      case "text":
        return (
          <div
            className="nodrag"
            onDragOver={(e) => {
              //console.log("🔄 DRAG OVER wrapper div for:", f.key);
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              //console.log("💧 DROP EVENT on wrapper div for:", f.key);
              e.preventDefault();
              e.stopPropagation();
              
              //console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
              //console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
              
              handleDrop(
                f.key,
                (val: string) => handleChange(f.key, val),
                e,
                fieldState[f.key] || ""
              );
            }}
          >
            <Input 
              {...commonInputProps} 
            />
            {isReference && (
              <div className="text-xs text-gray-500 mt-1">
                Preview: {getFieldPreview(f.key)}
              </div>
            )}
          </div>
        );
      
      case "textarea":
        return (
          <div
            className="nodrag"
            onDragOver={(e) => {
              //console.log("🔄 DRAG OVER textarea wrapper for:", f.key);
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(e) => {
              //console.log("💧 DROP EVENT on textarea wrapper for:", f.key);
              e.preventDefault();
              e.stopPropagation();
              
              //console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
              //console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
              
              handleDrop(
                f.key,
                (val: string) => handleChange(f.key, val),
                e,
                fieldState[f.key] || ""
              );
            }}
          >
            <textarea
              {...commonInputProps}
              className="w-full border rounded p-2 text-sm min-h-[100px] nodrag"
            />
            {isReference && (
              <div className="text-xs text-gray-500 mt-1">
                Preview: {getFieldPreview(f.key)}
              </div>
            )}
          </div>
        );
      
      case "select":
        if (f.optionsSource === "credentialsApi") {
          return (
            <div className="flex gap-2 items-center">
              <Select
                value={fieldState[f.key]}
                onValueChange={(val) => {
                  handleChange(f.key, val);
                  // Fetch options for dependent API fields
                  const dependentApiFields = definition.fields?.filter(
                    (field: any) =>
                      field.dependsOn === f.key && field.optionsSource === "dependentApi"
                  );
                  dependentApiFields?.forEach((depField: any) => {
                    fetchDependentOptions(depField, val);
                  });
                }}
                disabled={loadingSelect[f.key]}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={loadingSelect[f.key] ? "Loading..." : "Select credential"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(selectOptions[f.key] || []).length > 0 ? (
                    selectOptions[f.key].map((c: any) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.name}
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
          );
        }
        
        if (f.optionsSource === "dependentApi") {
          return (
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
          );
        }
        
        // Handle storeWorkflowsApi - workflows dropdown for Store node
        if (f.optionsSource === "storeWorkflowsApi") {
          const options = selectOptions[f.key] || [];
          const isLoading = loadingSelect[f.key];
          
          return (
            <Select
              value={fieldState[f.key] || undefined}
              onValueChange={(val) => {
                // Build batch update to avoid stale closure issue
                const updates: Record<string, any> = { [f.key]: val };
                
                // Clear dependent variable fields when workflow changes
                const variableFields = definition.fields?.filter(
                  (field: any) => field.optionsSource === "storeVariablesApi" && field.dependsOn === f.key
                );
                variableFields?.forEach((varField: any) => {
                  updates[varField.key] = "";
                });
                
                handleFieldStateBatch(updates);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={isLoading ? "Loading workflows..." : f.placeholder || "Select workflow"}
                />
              </SelectTrigger>
              <SelectContent>
                {options.length > 0 ? (
                  options.map((workflow: any) => (
                    <SelectItem 
                      key={workflow.id || workflow.value} 
                      value={workflow.id || workflow.value}
                    >
                      {workflow.name || workflow.label || workflow.id}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-workflows" disabled>
                    {isLoading ? "Loading..." : "No workflows found"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          );
        }

        // Handle storeVariablesApi - variables dropdown (depends on workflow selection)
        if (f.optionsSource === "storeVariablesApi") {
          const parentField = f.dependsOn;
          const hasParentValue = !!fieldState[parentField];
          
          return (
            <Select
              value={fieldState[f.key] || undefined}
              onValueChange={(val) => handleChange(f.key, val)}
              disabled={loadingSelect[f.key] || !hasParentValue}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    !hasParentValue
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
                    {!hasParentValue 
                      ? "Select workflow first" 
                      : loadingSelect[f.key] 
                      ? "Loading..." 
                      : "No variables found"}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          );
        }
        
        // Determine options to display
        let displayOptions: any[] = [];
        
        // Handle dynamicOptions (e.g., Transform node operator based on dataType)
        if (f.dynamicOptions?.dependsOn && f.dynamicOptions?.optionsByValue) {
          const parentValue = fieldState[f.dynamicOptions.dependsOn];
          displayOptions = f.dynamicOptions.optionsByValue[parentValue] || [];
        }
        // Handle conditional options
        else if (f.dependsOn && f.conditionalOptions) {
          const parentValue = fieldState[f.dependsOn];
          displayOptions = f.conditionalOptions[parentValue] || [];
        }
        // Handle regular options
        else {
          displayOptions = selectOptions[f.key] || f.options || [];
        }

        return (
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
              // Fetch options for dependent API fields
              const dependentApiFields = definition.fields?.filter(
                (field: any) =>
                  field.dependsOn === f.key && field.optionsSource === "dependentApi"
              );
              dependentApiFields?.forEach((depField: any) => {
                fetchDependentOptions(depField, val);
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={f.placeholder || "Select option"} />
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

      case "checkbox":
        return (
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">{f.label}</span>
            <Switch
              checked={!!fieldState[f.key]}
              onCheckedChange={(checked) => handleChange(f.key, checked)}
            />
          </div>
        );

      case "multiselect":
        {const selectedValues = Array.isArray(fieldState[f.key]) ? fieldState[f.key] : (f.default || []);
        const availableOptions = selectOptions[f.key] || f.options || [];
        
        return (
          <div className="space-y-3">
            {availableOptions.map((opt: any) => {
              const optionId = opt.id || opt.value;
              const optionLabel = opt.name || opt.label || opt.id || opt.value;
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
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {definition?.icon && (() => {
            // Use inline SVG components for instant rendering
            const IconComponent = IconRegistry[definition.name as keyof typeof IconRegistry];
            if (IconComponent) {
              return <IconComponent className="w-6 h-6" />;
            }

            // Fallback to cached image for other icons
            return (
              <CachedIcon
                src={definition.icon}
                alt="Node icon"
                className="w-6 h-6"
                fallback={
                  <div className="w-6 h-6 bg-muted rounded flex items-center justify-center">
                    <span className="text-xs">{definition.name?.[0] || '?'}</span>
                  </div>
                }
              />
            );
          })()}
          <h2 className="font-semibold text-base text-foreground flex-1">
            {definition?.def || definition?.name || 'Node'}
          </h2>
        </div>
      </div>

      {/* Visualization for Visualize node */}
      {isVisualize && (
        <div className="py-2">
          {vizCandles?.t?.length ? (
            <VisualizeCandlesSignals
              candles={vizCandles}
              indicator={{
                name: definition.name,
                color: "#1e40af",
                data: filteredIndicator,
              }}
            />
          ) : (
            <div className="text-gray-500 text-sm py-8 text-center">
              No candle data to visualize
            </div>
          )}
          <div className="text-xs mt-2 flex gap-4">
            <span>
              <span className="inline-block w-3 h-3 rounded-full bg-green-600 mr-1" />
              Buy
            </span>
            <span>
              <span className="inline-block w-3 h-3 rounded-full bg-red-600 mr-1" />
              Sell
            </span>
          </div>
        </div>
      )}

      {/* Form for non-Visualize nodes */}
      {!isVisualize && (
        <form className="space-y-3" onSubmit={handleSubmit}>
          {(definition.fields || []).map((f: any) => {
            // Skip hidden fields entirely
            if (f.type === "hidden") {
              return null;
            }
            
            // Check if field should be shown
            if (f.displayOptions?.show) {
              const shouldShow = Object.entries(f.displayOptions.show).every(
                ([depKey, allowedValues]) => {
                  const currentValue = fieldState[depKey];
                  if (!currentValue) return false;
                  return (allowedValues as string[]).includes(currentValue);
                }
              );
              if (!shouldShow) return null;
            }

            // Determine dynamic label if configured
            let displayLabel = f.label;
            if (f.dynamicLabel?.dependsOn && f.dynamicLabel?.labelsByValue) {
              const dependentValue = fieldState[f.dynamicLabel.dependsOn];
              displayLabel = f.dynamicLabel.labelsByValue[dependentValue] || f.label;
            }

            return (
              <div key={f.key}>
                <Label>{displayLabel}</Label>
                {renderField(f)}
              </div>
            );
          })}

          {error && (
            <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded p-2">
              {error}
            </div>
          )}

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
      )}

      {showAuth && (
        <Suspense fallback={<div>Loading...</div>}>
          {definition.auth === 'SchwabAuthModal' ? (
            <SchwabAuthModal
              isOpen={showAuth}
              onClose={() => {
                setShowAuth(false);
                (definition.fields || []).forEach((f: any) => {
                  if (f.type === "select" && f.optionsSource === "credentialsApi") {
                    fetchCredentials(f.key);
                  }
                });
              }}
              onSuccess={(credentialId) => {
                setShowAuth(false);
                (definition.fields || []).forEach((f: any) => {
                  if (f.type === "select" && f.optionsSource === "credentialsApi") {
                    fetchCredentials(f.key);
                  }
                });
              }}
              userId={user?.id || ''}
            />
          ) : definition.auth === 'GmailAuthModal' ? (
            <GmailAuthModal
              isOpen={showAuth}
              onClose={() => {
                setShowAuth(false);
                (definition.fields || []).forEach((f: any) => {
                  if (f.type === "select" && f.optionsSource === "credentialsApi") {
                    fetchCredentials(f.key);
                  }
                });
              }}
              onSuccess={(credentialId) => {
                setShowAuth(false);
                (definition.fields || []).forEach((f: any) => {
                  if (f.type === "select" && f.optionsSource === "credentialsApi") {
                    fetchCredentials(f.key);
                  }
                });
              }}
              userId={user?.id || ''}
            />
          ) : (
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
          )}
        </Suspense>
      )}
    </>
  );
};

export default memo(BasicNodeLayout);
