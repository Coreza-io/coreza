import React, { Suspense, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import VisualizeCandlesSignals from "@/components/charts/VisualizeCandlesSignals";
import type { BaseNodeRenderProps } from "../BaseNode";

interface BasicNodeLayoutProps extends BaseNodeRenderProps {}

const BasicNodeLayout: React.FC<BasicNodeLayoutProps> = ({
  definition,
  fieldState,
  error,
  isSending,
  loadingSelect,
  selectOptions,
  showAuth,
  selectedInputData,
  handleChange,
  handleSubmit,
  handleDrop,
  getFieldPreview,
  setShowAuth,
  fetchCredentials,
  referenceStyle,
}) => {
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
    // Conditional field display logic
    if (f.displayOptions?.show) {
      const shouldShow = Object.entries(f.displayOptions.show).every(
        ([depKey, allowedValues]) => 
          (allowedValues as string[]).includes(fieldState[depKey])
      );
      if (!shouldShow) return null;
    }

    const commonInputProps = {
      value: fieldState[f.key] || "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => 
        handleChange(f.key, e.target.value),
      placeholder: f.placeholder,
      className: "nodrag",
      style: fieldState[f.key]?.includes("{{") ? referenceStyle : undefined,
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDrop: (e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const data = e.dataTransfer.getData("text/plain");
        if (data) {
          handleDrop(
            f.key,
            (val: string) => handleChange(f.key, val),
            e,
            fieldState[f.key] || ""
          );
        }
      },
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.target.select();
      }
    };

    switch (f.type) {
      case "text":
        return (
          <div>
            <Input 
              {...commonInputProps} 
            />
            {fieldState[f.key]?.includes("{{") && (
              <div className="text-xs text-gray-500 mt-1">
                Preview: {getFieldPreview(f.key)}
              </div>
            )}
          </div>
        );
      
      case "textarea":
        return (
          <div>
            <textarea
              {...commonInputProps}
              className="w-full border rounded p-2 text-sm min-h-[100px] nodrag"
            />
            {fieldState[f.key]?.includes("{{") && (
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
                onValueChange={(val) => handleChange(f.key, val)}
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
        return (
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
        );
      
      default:
        return null;
    }
  };

  return (
    <>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          {definition?.icon && (
            <img 
              src={definition.icon} 
              alt="Node icon" 
              className="w-6 h-6" 
            />
          )}
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
          {(definition.fields || []).map((f: any) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              {renderField(f)}
            </div>
          ))}

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

export default BasicNodeLayout;
