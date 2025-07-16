import React, { Suspense } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, X } from "lucide-react";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import type { BaseNodeRenderProps } from "../BaseNode";

interface ConditionalNodeLayoutProps extends BaseNodeRenderProps {}

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
}) => {
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
                <div
                  className="nodrag"
                  onDragOver={(e) => {
                    console.log("🔄 DRAG OVER wrapper div for:", f.key);
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    console.log("💧 DROP EVENT on wrapper div for:", f.key);
                    e.preventDefault();
                    e.stopPropagation();
                    
                    console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
                    console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
                    
                    handleDrop(
                      f.key,
                      (val: string) => handleChange(f.key, val),
                      e,
                      fieldState[f.key] || ""
                    );
                  }}
                >
                  <Input
                    value={fieldState[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) => handleChange(f.key, e.target.value)}
                    onDragOver={(e) => {
                      console.log("🔄 DRAG OVER input field:", f.key);
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      console.log("💧 DROP EVENT on input field:", f.key);
                      e.preventDefault();
                      e.stopPropagation();
                      
                      console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
                      console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
                      
                      handleDrop(
                        f.key,
                        (val: string) => handleChange(f.key, val),
                        e,
                        fieldState[f.key] || ""
                      );
                    }}
                    onFocus={(e) => e.target.select()}
                    style={fieldState[f.key]?.includes("{{") ? referenceStyle : {}}
                    className="nodrag"
                  />
                  {fieldState[f.key]?.includes("{{") && (
                    <div className="text-xs text-gray-500 mt-1">
                      Preview: {getFieldPreview(f.key)}
                    </div>
                  )}
                </div>
              )}

              {/* --------- Textarea Field --------- */}
              {f.type === "textarea" && (
                <div
                  className="nodrag"
                  onDragOver={(e) => {
                    console.log("🔄 DRAG OVER textarea wrapper for:", f.key);
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    console.log("💧 DROP EVENT on textarea wrapper for:", f.key);
                    e.preventDefault();
                    e.stopPropagation();
                    
                    console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
                    console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
                    
                    handleDrop(
                      f.key,
                      (val: string) => handleChange(f.key, val),
                      e,
                      fieldState[f.key] || ""
                    );
                  }}
                >
                  <textarea
                    className="w-full border rounded p-2 text-sm min-h-[100px] nodrag"
                    value={fieldState[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) => handleChange(f.key, e.target.value)}
                    onDragOver={(e) => {
                      console.log("🔄 DRAG OVER textarea field:", f.key);
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      console.log("💧 DROP EVENT on textarea field:", f.key);
                      e.preventDefault();
                      e.stopPropagation();
                      
                      console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
                      console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
                      
                      handleDrop(
                        f.key,
                        (val: string) => handleChange(f.key, val),
                        e,
                        fieldState[f.key] || ""
                      );
                    }}
                    onFocus={(e) => e.target.select()}
                    style={fieldState[f.key]?.includes("{{") ? referenceStyle : {}}
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

              {/* --------- Repeater Field (Complex Conditional Logic) --------- */}
              {f.type === "repeater" && (
                <div className="space-y-2">
                  {(fieldState[f.key] || [f.default || {}]).map((item: any, index: number) => (
                    <React.Fragment key={index}>
                      {/* Show AND/OR dropdown between conditions (except before first condition) */}
                      {index > 0 && (
                        <div className="flex justify-start py-2 pl-2">
                          <Select
                            value={item.logicalOp || "AND"}
                            onValueChange={(val) => {
                              const newItems = [...(fieldState[f.key] || [])];
                              newItems[index] = { ...newItems[index], logicalOp: val };
                              handleChange(f.key, newItems);
                            }}
                          >
                            <SelectTrigger className="w-20 h-8 text-xs bg-background border border-border z-50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-background border border-border shadow-lg z-50">
                              <SelectItem value="AND" className="text-xs">AND</SelectItem>
                              <SelectItem value="OR" className="text-xs">OR</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      
                      {/* Condition Row */}
                      <div className="flex items-center gap-2 p-2 border rounded bg-muted/10">
                        {f.subFields?.map((subField: any) => (
                          <React.Fragment key={subField.key}>
                            {subField.options ? (
                              <div className="flex-1">
                                <Select
                                  value={item[subField.key] || ""}
                                  onValueChange={(val) => {
                                    const newItems = [...(fieldState[f.key] || [])];
                                    newItems[index] = { ...newItems[index], [subField.key]: val };
                                    handleChange(f.key, newItems);
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs bg-background border border-border z-40">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                  <SelectContent className="bg-background border border-border shadow-lg z-40">
                                    {subField.options.map((opt: any) => (
                                      <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : (
                              <div 
                                className="flex-1 nodrag"
                                onDragOver={(e) => {
                                  console.log("🔄 DRAG OVER repeater field wrapper for:", subField.key, "index:", index);
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.dataTransfer.dropEffect = "copy";
                                }}
                                onDrop={(e) => {
                                  console.log("💧 DROP EVENT on repeater field wrapper for:", subField.key, "index:", index);
                                  e.preventDefault();
                                  e.stopPropagation();
                                  
                                  console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
                                  console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
                                  
                                  const reference = e.dataTransfer.getData("application/reactflow") || e.dataTransfer.getData("text/plain");
                                  if (reference) {
                                    // Call the handleDrop function to maintain JSON format and create proper references
                                    handleDrop(
                                      `${f.key}[${index}].${subField.key}`,
                                      (val: string) => {
                                        const newItems = [...(fieldState[f.key] || [])];
                                        newItems[index] = { ...newItems[index], [subField.key]: val };
                                        handleChange(f.key, newItems);
                                      },
                                      e,
                                      item[subField.key] || ""
                                    );
                                  }
                                }}
                              >
                                <input
                                  type="text"
                                  className="w-full border rounded px-3 py-1 text-xs h-8 nodrag bg-background border-border focus:border-primary focus:outline-none"
                                  placeholder={subField.placeholder}
                                  value={item[subField.key] || ""}
                                  onChange={(e) => {
                                    const newItems = [...(fieldState[f.key] || [])];
                                    newItems[index] = { ...newItems[index], [subField.key]: e.target.value };
                                    handleChange(f.key, newItems);
                                  }}
                                  onDragOver={(e) => {
                                    console.log("🔄 DRAG OVER repeater input field:", subField.key, "index:", index);
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.dataTransfer.dropEffect = "copy";
                                  }}
                                  onDrop={(e) => {
                                    console.log("💧 DROP EVENT on repeater input field:", subField.key, "index:", index);
                                    e.preventDefault();
                                    e.stopPropagation();
                                    
                                    console.log("📦 Available data types:", Array.from(e.dataTransfer.types));
                                    console.log("📦 Data content:", e.dataTransfer.getData("application/reactflow"));
                                    
                                    const reference = e.dataTransfer.getData("application/reactflow") || e.dataTransfer.getData("text/plain");
                                    if (reference) {
                                      // Call the handleDrop function to maintain JSON format and create proper references  
                                      handleDrop(
                                        `${f.key}[${index}].${subField.key}`,
                                        (val: string) => {
                                          const newItems = [...(fieldState[f.key] || [])];
                                          newItems[index] = { ...newItems[index], [subField.key]: val };
                                          handleChange(f.key, newItems);
                                        },
                                        e,
                                        item[subField.key] || ""
                                      );
                                    }
                                  }}
                                  onFocus={(e) => e.target.select()}
                                />
                                {item[subField.key]?.includes("{{") && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    Preview: {getFieldPreview(`${f.key}[${index}].${subField.key}`)}
                                  </div>
                                )}
                              </div>
                            )}
                          </React.Fragment>
                        ))}
                        
                        {index > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newItems = [...(fieldState[f.key] || [])];
                              newItems.splice(index, 1);
                              handleChange(f.key, newItems);
                            }}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </React.Fragment>
                  ))}
                  
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const newItems = [...(fieldState[f.key] || []), { ...f.default, logicalOp: "AND" }];
                      handleChange(f.key, newItems);
                    }}
                    className="w-full text-xs h-8 mt-3"
                  >
                    + Add Condition
                  </Button>
                </div>
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