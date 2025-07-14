import React, { Suspense } from "react";
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
  // ======== VISUALIZE NODE SUPPORT =========
  const isVisualize = definition?.name === "Visualize";
  let vizCandles = null;
  let vizIndicator = null;

  function toDictOfArrays(candlesArray: any) {
    if (!Array.isArray(candlesArray)) return candlesArray;
    const result = { t: [], o: [], h: [], l: [], c: [], v: [] } as any;
    for (const c of candlesArray) {
      result.t.push(c.t ? c.t.slice(0, 10) : undefined);
      result.o.push(c.o);
      result.h.push(c.h);
      result.l.push(c.l);
      result.c.push(c.c);
      result.v.push(c.v);
    }
    return result;
  }

  if (isVisualize && selectedInputData) {
    let firstInput = Array.isArray(selectedInputData) ? selectedInputData[0] : selectedInputData;
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
  }

  const filteredIndicator = Array.isArray(vizIndicator)
    ? vizIndicator.filter((d: any) => d && d.value !== null && !isNaN(d.value))
    : [];

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

      {/* ====== Visualization Chart for Visualize node ====== */}
      {isVisualize && (
        <div className="py-2">
          {vizCandles && vizCandles.t && vizCandles.t.length > 0 ? (
            <VisualizeCandlesSignals
              candles={vizCandles}
              indicator={{
                name: definition.name,
                color: "#1e40af",
                data: filteredIndicator,
              }}
            />
          ) : (
            <div className="text-gray-500 text-sm py-8 text-center">No candle data to visualize</div>
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
      {/* ====== End Visualization Chart ====== */}

      {!isVisualize && (
        <form className="space-y-3" onSubmit={handleSubmit}>
          {(definition.fields || []).map((f: any) => {
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
                  <>
                    <Input
                      value={fieldState[f.key]}
                      placeholder={f.placeholder}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      onDragOver={(e) => {
                        console.log("dragOver triggered");
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDragEnter={(e) => {
                        console.log("dragEnter triggered");
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onFocus={(e) => e.target.select()}
                      style={fieldState[f.key]?.includes("{{") ? referenceStyle : {}}
                      onDrop={(e) =>
                        handleDrop(
                          f.key,
                          (val) =>
                            handleChange(f.key, val),
                          e,
                          fieldState[f.key] ?? ""
                        )
                      }
                      className="nodrag"
                    />
                    {fieldState[f.key]?.includes("{{") && (
                      <div className="text-xs text-gray-500 mt-1">
                        Preview: {getFieldPreview(f.key)}
                      </div>
                    )}
                  </>
                )}

                {/* --------- Textarea Field --------- */}
                {f.type === "textarea" && (
                  <>
                    <textarea
                      className="w-full border rounded p-2 text-sm min-h-[100px] nodrag"
                      value={fieldState[f.key]}
                      placeholder={f.placeholder}
                      onChange={(e) => handleChange(f.key, e.target.value)}
                      onDragOver={(e) => {
                        console.log("textarea dragOver triggered");
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDragEnter={(e) => {
                        console.log("textarea dragEnter triggered");
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onFocus={(e) => e.target.select()}
                      style={fieldState[f.key]?.includes("{{") ? referenceStyle : {}}
                      onDrop={(e) =>
                        handleDrop(
                          f.key,
                          (val) =>
                            handleChange(f.key, val),
                          e,
                          fieldState[f.key] ?? ""
                        )
                      }
                    />
                    {fieldState[f.key]?.includes("{{") && (
                      <div className="text-xs text-gray-500 mt-1">
                        Preview: {getFieldPreview(f.key)}
                      </div>
                    )}
                  </>
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
