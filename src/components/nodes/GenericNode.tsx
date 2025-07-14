import React, { useState, useEffect, useMemo, Suspense, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  useNodeId,
  useNodes,
  useEdges,
  useReactFlow
} from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { Loader2, X } from "lucide-react";
import NodeWrapper from "@/utils/NodeWrapper";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import GenericAuthModal from "@/components/auth/GenericAuthModal";
import VisualizeCandlesSignals from "@/components/charts/VisualizeCandlesSignals";

const BACKEND_URL = "http://localhost:8000";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
const getDisplayName = (node: Node<any>, allNodes: Node<any>[]) => {
  const baseName = node.data.definition?.name || node.data.config?.name || 'Node';
  const sameType = allNodes.filter((n) => (n.data.definition?.name || n.data.config?.name) === baseName);
  const idx = sameType.findIndex((n) => n.id === node.id);
  return idx > 0 ? `${baseName}${idx}` : baseName;
};

function getUserId(): string {
  try {
    const user = JSON.parse(localStorage.getItem("loggedInUser") || "{}");
    return user.id || user.user_id || "";
  } catch {
    return "";
  }
}

const GenericNode: React.FC<any> = ({ data, selected }) => {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const edges = useEdges();
  const { setNodes } = useReactFlow();

  const definition = data.definition || data.config;
  // Compute this node's own displayName (for the label)
  const displayName = useMemo(
    () => getDisplayName({ id: nodeId!, data } as Node<any>, nodes),
    [nodes, definition?.name, nodeId]
  );

  const [showAuth, setShowAuth] = useState(false);

  const [selectedPrevNodeId, setSelectedPrevNodeId] = useState<string>("");
  const previousNodes = useMemo(() => {
    if (!nodeId || !nodes || !edges) return [];
    return getAllUpstreamNodes(nodeId, edges, nodes);
  }, [nodeId, nodes, edges]);

  useEffect(() => {
    if (previousNodes.length > 0 && !selectedPrevNodeId) {
      setSelectedPrevNodeId(previousNodes[0].id);
    }
  }, [previousNodes, selectedPrevNodeId]);

  const selectedPrevNode =
    previousNodes.find((n) => n.id === selectedPrevNodeId) || previousNodes[0];
  const selectedInputData =
    selectedPrevNode?.data?.output || selectedPrevNode?.data || {};

  const [fieldState, setFieldState] = useState<Record<string, any>>(() =>
    definition && definition.fields
      ? Object.fromEntries(
          definition.fields.map((f: any) => [
            f.key, 
            f.type === "repeater" 
              ? data.values?.[f.key] || [f.default || {}]
              : data.values?.[f.key] || ""
          ])
        )
      : {}
  );

  // whenever we get a fresh definition or values (i.e. on reload), re-hydrate
  useEffect(() => {
    if (!definition?.fields) return;
    setFieldState(
      Object.fromEntries(
        definition.fields.map((f: any) => [
          f.key, 
          f.type === "repeater" 
            ? data.values?.[f.key] || [f.default || {}]
            : data.values?.[f.key] || ""
        ])
      )
    );
  }, [definition?.fields, data.values]);

  const [error, setError] = useState("");
  const [loadingSelect, setLoadingSelect] = useState<Record<string, boolean>>(
    {}
  );
  const [selectOptions, setSelectOptions] = useState<Record<string, any[]>>({});
  const [isSending, setIsSending] = useState(false);
  const [lastOutput, setLastOutput] = useState<any>({ status: "pending" });

  // =================== Save/Pin Panel state ===================
  const [overrideOutput, setOverrideOutput] = useState<any | null>(null);

  const handlePanelSave = useCallback((newData: any) => {
    setOverrideOutput(newData);
    setLastOutput(newData); // optional, so panel shows changes immediately
    data.output = newData;  // update data prop if needed for downstream
  }, [data]);

  const handlePanelPinToggle = useCallback(() => {
    if (overrideOutput == null) {
      setOverrideOutput(lastOutput);
    } else {
      setOverrideOutput(null);
      setLastOutput(data.output || {});
    }
  }, [overrideOutput, lastOutput, data]);
  // This is the visible output: either the pinned edit or last run output
  const displayedData = overrideOutput !== null ? overrideOutput : lastOutput;
  // Is pinned if overrideOutput is set
  const isPinned = overrideOutput !== null;
  // ============================================================

  const [sourceMap, setSourceMap] = useState<Record<string, string>>({});

  const handleDragStart = (
    e: React.DragEvent,
    keyPath: string,
    value: string
  ) => {
    e.dataTransfer.setData(
      "application/reactflow",
      JSON.stringify({
        type: "jsonReference",
        keyPath,
        value,
      })
    );
    e.dataTransfer.effectAllowed = "copy";
    document.body.classList.add("cursor-grabbing", "select-none");
  };

  const handleChange = (key: string, value: any) => {
    setFieldState((fs) => ({ ...fs, [key]: value }));
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                values: {
                  ...((n.data as any)?.values || {}),
                  [key]: value,
                },
              },
            }
          : n
      )
    );
  };

  const handleDrop = (
    fieldKey: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    e: React.DragEvent,
    currentValue: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const raw = e.dataTransfer.getData("application/reactflow");
      console.log("raw",raw)
      if (!raw) return;
      const { keyPath } = JSON.parse(raw);
      // ▶️ INJECT SOURCE NODE'S UNIQUE DISPLAY NAME FOR DRAG-AND-DROP
      // locate the node where the drag originated
      const sourceNode = nodes.find((n) => n.id === selectedPrevNodeId);
      const sourceDisplayName = sourceNode
          ? getDisplayName(sourceNode, nodes)
          : definition?.name || 'Node';
      //console.log("sourceDisplayName",sourceDisplayName)
      //const insert = `{{ $json.${keyPath} }}`;
      const insert = `{{ $('${sourceDisplayName}').json.${keyPath} }}`;
      //const insert = `{{ $('${displayName}').item.json.${keyPath} }}`;
      const newValue = currentValue + insert;
      console.log("newValue", newValue )
      setter(newValue);
      handleChange(fieldKey, newValue);
      setSourceMap((sm) => ({ ...sm, [fieldKey]: selectedPrevNodeId }));
    } catch (err) {
      console.error("Drop error:", err);
    }
    document.body.classList.remove("cursor-grabbing", "select-none");
  };

  const getFieldPreview = (fieldKey: string) => {
    const expr = fieldState[fieldKey] || "";
    if (!expr.includes("{{")) return null;
    const srcId = sourceMap[fieldKey] || selectedPrevNodeId;
    const srcNode = previousNodes.find((n) => n.id === srcId) || selectedPrevNode;
    const srcData = srcNode?.data?.output || srcNode?.data || {};
    try {
      const resolved = resolveReferences(expr, srcData);
      return summarizePreview(resolved);
    } catch {
      return "";
    }
  };

  const userId = getUserId();

  const fetchCredentials = async (fieldKey: string) => {
    setLoadingSelect((prev) => ({ ...prev, [fieldKey]: true }));
    try {
      const apiName = (definition?.parentNode || definition?.name || "").toLowerCase();
      console.log("Cred apiName",apiName)
      //let payload: Record<string, any> = {};
      //payload["userId"] = userId; 
      const res = await fetch(
        `${BACKEND_URL}/${apiName}/credentials?user_id=${userId}`
      );
      const json = await res.json();
      setSelectOptions((opts) => ({
        ...opts,
        [fieldKey]: json.credentials || [],
      }));
    } catch {
      setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
    } finally {
      setLoadingSelect((prev) => ({ ...prev, [fieldKey]: false }));
    }
  };

  useEffect(() => {
    (definition?.fields || []).forEach(async (f: any) => {
      if (f.type === "select" && f.optionsSource === "credentialsApi") {
        fetchCredentials(f.key);
      }
      if (f.type === "select" && f.options) {
        setSelectOptions((opts) => ({ ...opts, [f.key]: f.options! }));
      }
    });
    // eslint-disable-next-line
  }, [definition?.fields, definition?.name]);

  function collectUpstreamOutputs(previousNodes: Node[]): Record<string, any> {
    const obj: Record<string, any> = {};

    previousNodes.forEach((node) => {
      const key =
        node.type ??
        (node.data as any)?.definition?.name ??
        `node_${node.id}`;

      const output = (node.data as any)?.output;
      if (output && Object.keys(output).length) {
        obj[key] = output;
      }
    });

    return obj;
  }

  function collectNodeData() {
    // 1. Get data from connected SUPPORT nodes (OpenAI)
    const supportData = edges
      .filter(e => e.target === nodeId)
      .reduce((acc, edge) => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        if ((sourceNode?.data as any)?.definition?.node_type === 'support') {
          return { ...acc, ...(sourceNode.data as any)?.output || {} };
        }
        return acc;
      }, {} as Record<string, any>);
    return { supportData };
  }

  function buildPayload(
    fieldState: Record<string, any>,
    supportData: Record<string, any>,
    selectedInputData: Record<string, any>,
    userId: string
  ): Record<string, any> {
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(fieldState)) {
      payload[key] = typeof value === 'string'
        ? resolveReferences(value, selectedInputData)
        : value;
    }
    return {
      ...payload,
      ...(Array.isArray(supportData) ? supportData[0] || {} : supportData),
      user_id: userId
    };
  }

  // --------- Run/Send logic ----------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate required fields
    // Validate required fields *only if visible*
    for (const f of definition?.fields || []) {
      // check displayOptions.show, skip if not matching
      let shouldShow = true;
      if (f.displayOptions?.show) {
        for (const [depKey, rawAllowed] of Object.entries(f.displayOptions.show)) {
          const allowedValues = Array.isArray(rawAllowed) ? rawAllowed as string[] : [];
          if (!allowedValues.includes(fieldState[depKey])) {
            shouldShow = false;
            break;
          }
        }
      }
      // skip hidden fields
      if (!shouldShow) continue;

      // now validate
      if (f.required && !fieldState[f.key]) {
        setError(`${f.label || f.key} is required`);
        return;
      }
    }
    setError("");
    setIsSending(true);

    try {
      // Build payload
      //const upstreamData = collectUpstreamOutputs(previousNodes);
      const { supportData } = collectNodeData();
      const payload = buildPayload(fieldState, supportData, selectedInputData, userId);
      payload.user_id = userId; 
      console.log("Output_payload", payload)
      let outputData: any;
      // -- Template fieldState with operation info --
      const operationField = (definition?.fields || []).find((f: any) => f.key === "operation");
      let operationMethod = "POST";
      if (operationField) {
        const opSelected = (operationField.options || []).find((opt: any) => opt.id === fieldState.operation);
        if (opSelected && opSelected.method) {
          operationMethod = opSelected.method;
        }
      }

      // -- Replace {{operation}} and {{method}} in action config --
      let url = definition?.action?.url || '';
      let method = definition?.action?.method || "POST";
      if (url.includes("{{") && url.includes("}}")) {
        url = url.replace(/\{\{(\w+)\}\}/g, (_, key) => fieldState[key] || "");
      }

      if (method.includes("{{") && method.includes("}}")) {
        method = method.replace(/\{\{(\w+)\}\}/g, (_, key) =>
          key === "method" ? operationMethod : fieldState[key] || ""
        );
      }
      console.log("url/method", url, method)

      // Execute action or echo payload
      if (definition?.action?.url && definition?.action?.method) {
        // 3. If it's a GET, turn your payload into query params:
        let fullUrl = `${BACKEND_URL}${url}`;
        if (method === "GET") {
          const params = new URLSearchParams();
          // these two are required by your backend:
          params.append("user_id", userId);
          params.append("credential_id", fieldState.credential_id ?? "");
          // if you have other GET-only fields you can append them here too…
          fullUrl += `?${params.toString()}`;
        }
        //const method = definition.action.method || "POST";
        // Build fetch options without a body if GET
        const fetchOptions: RequestInit = { method };
        if (method !== "GET") {
          fetchOptions.headers = { "Content-Type": "application/json" };
          fetchOptions.body    = JSON.stringify(payload);
        }

        const res = await fetch(fullUrl, fetchOptions);
        
        const responseData = await res.json();
        if (!res.ok) throw new Error(responseData.detail || "Action failed");
        outputData = [responseData];
      } else {
        outputData = [payload];
      }

      // Update lastOutput state
      setLastOutput(outputData);

      // Determine what to propagate: use pinned override if set, otherwise fresh output
      const finalOutput = overrideOutput !== null ? overrideOutput : outputData;

      // Update this node's data.output
      data.output = finalOutput;

      // Propagate to React Flow: this node and all downstream targets
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, output: finalOutput } }
            : n
        );
        edges
          .filter((e) => e.source === nodeId)
          .forEach((edge) => {
            const idx = updated.findIndex((n) => n.id === edge.target);
            if (idx !== -1) {
              updated[idx] = {
                ...updated[idx],
                data: {
                  ...updated[idx].data,
                  input: finalOutput,
                  lastUpdated: new Date().toISOString(),
                },
              };
            }
          });
        return updated;
      });
    } catch (err: any) {
      setError(err.message || "Action failed");
      setLastOutput({
        status: "error",
        message: err.message,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setIsSending(false);
    }
  };


  const referenceStyle = {
    backgroundColor: "hsl(var(--muted))",
    borderBottom: "1px dashed hsl(var(--primary))",
  };

  // ======== VISUALIZE NODE SUPPORT =========
  const isVisualize = definition?.name === "Visualize";
  let vizCandles = null;
  let vizIndicator = null;
  function toDictOfArrays(candlesArray: any) {
    if (!Array.isArray(candlesArray)) return candlesArray;
    const result = { t: [], o: [], h: [], l: [], c: [], v: [] } as any;
    for (const c of candlesArray) {
      result.t.push(c.t ? c.t.slice(0, 10) : undefined); // <-- only yyyy-mm-dd
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
    // Accept both array-of-objects or dict-of-arrays
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

  const filteredIndicator =
    Array.isArray(vizIndicator)
      ? vizIndicator.filter((d: any) => d && d.value !== null && !isNaN(d.value))
      : [];

  // ======== END VISUALIZE NODE SUPPORT ======

  if (!definition) {
    return (
      <div className="min-w-[180px] shadow-node border-node bg-card rounded-lg p-3">
        <span className="text-sm text-muted-foreground">No definition found</span>
      </div>
    );
  }

  return (
    <NodeWrapper
      nodeId={nodeId}
      nodes={nodes}
      edges={edges}
      selected={selected}
      inputPanelProps={{
        handleDragStart,
        selectedPrevNodeId,
        setSelectedPrevNodeId,
      }}
      outputPanelProps={{
        data: displayedData,
        position: "right",
        pinned: isPinned,
        onSave: handlePanelSave,
        onPinToggle: handlePanelPinToggle,
      }}
      icon={
        definition.icon ? (
          <img src={definition.icon} className="w-10 h-10" alt="node icon" />
        ) : undefined
      }
      //label={definition.name}
      label={displayName}
      minWidth={definition.size?.width || 340}
      minHeight={definition.size?.height || 340}
      handles={definition.handles || []}
      nodeType={definition.node_type}
    >
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
              //signals={vizSignals}
              indicator={
                {
                  name: definition.name,
                  color: "#1e40af",
                  data: filteredIndicator,
                }
              }
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
                      onDragOver={(e) => e.preventDefault()}
                      onFocus={(e) => e.target.select()}
                      style={
                        fieldState[f.key]?.includes("{{") ? referenceStyle : {}
                      }
                      onDrop={(e) =>
                        handleDrop(
                          f.key,
                          (val) =>
                            setFieldState((fs) => ({
                              ...fs,
                              [f.key]: val,
                            })),
                          e,
                          fieldState[f.key] ?? ""
                        )
                      }
                      className="nodrag"
                    />
                    {/* Reference preview */}
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
                      onDragOver={(e) => e.preventDefault()}
                      onFocus={(e) => e.target.select()}
                      style={
                        fieldState[f.key]?.includes("{{") ? referenceStyle : {}
                      }
                      onDrop={(e) =>
                        handleDrop(
                          f.key,
                          (val) =>
                            setFieldState((fs) => ({
                              ...fs,
                              [f.key]: val,
                            })),
                          e,
                          fieldState[f.key]
                        )
                      }
                    />
                    {/* Reference preview */}
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
                      <SelectValue
                        placeholder={f.placeholder || "Select option"}
                      />
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

                {/* --------- Repeater Field --------- */}
                {f.type === "repeater" && (
                  <div className="space-y-3">
                    {(fieldState[f.key] || [f.default || {}]).map((item: any, index: number) => (
                      <React.Fragment key={index}>
                        {/* Show AND/OR dropdown between conditions (except before first condition) */}
                        {index > 0 && (
                          <div className="flex justify-center py-1">
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
                        <div className="flex items-center gap-2 p-2 border rounded">
                          {f.subFields?.map((subField: any, subIndex: number) => (
                            <React.Fragment key={subField.key}>
                              {subField.options ? (
                                <Select
                                  value={item[subField.key] || ""}
                                  onValueChange={(val) => {
                                    const newItems = [...(fieldState[f.key] || [])];
                                    newItems[index] = { ...newItems[index], [subField.key]: val };
                                    handleChange(f.key, newItems);
                                  }}
                                >
                                  <SelectTrigger className="flex-1 h-8 text-xs bg-background border border-border z-40">
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
                              ) : (
                                <input
                                  type="text"
                                  className="flex-1 border rounded px-2 py-1 text-xs h-8 nodrag bg-background border-border"
                                  placeholder={subField.placeholder}
                                  value={item[subField.key] || ""}
                                  onChange={(e) => {
                                    const newItems = [...(fieldState[f.key] || [])];
                                    newItems[index] = { ...newItems[index], [subField.key]: e.target.value };
                                    handleChange(f.key, newItems);
                                  }}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    const reference = e.dataTransfer.getData("text/plain");
                                    if (reference) {
                                      const newItems = [...(fieldState[f.key] || [])];
                                      newItems[index] = { ...newItems[index], [subField.key]: reference };
                                      handleChange(f.key, newItems);
                                    }
                                  }}
                                />
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
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
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
                      className="w-full text-xs h-8"
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
      )}


      {showAuth && GenericAuthModal && (
        <Suspense fallback={<div>Loading...</div>}>
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
        </Suspense>
      )}
    </NodeWrapper>
  );
};

export default GenericNode;