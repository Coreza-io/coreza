import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";

const BACKEND_URL = "http://localhost:8000";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
const getDisplayName = (node: Node<any>, allNodes: Node<any>[]) => {
  const baseName = node.data.definition?.name || node.data.config?.name || 'Node';
  const sameType = allNodes.filter((n) => n && n.data && (n.data.definition?.name || n.data.config?.name) === baseName);
  const idx = sameType.findIndex((n) => n.id === node.id);
  return idx > 0 ? `${baseName}${idx}` : baseName;
};

function getUserId(): string {
  try {
    // First try the new format
    const user = JSON.parse(localStorage.getItem("loggedInUser") || "{}");
    if (user.id || user.user_id) {
      return user.id || user.user_id;
    }
    
    // Fallback to old format
    const userId = localStorage.getItem("userId");
    return userId || "";
  } catch {
    // Fallback to old format on JSON parse error
    return localStorage.getItem("userId") || "";
  }
}

interface BaseNodeProps {
  data: any;
  selected: boolean;
  children: (props: BaseNodeRenderProps) => React.ReactNode;
}

export interface BaseNodeRenderProps {
  definition: any;
  displayName: string;
  fieldState: Record<string, any>;
  error: string;
  isSending: boolean;
  loadingSelect: Record<string, boolean>;
  selectOptions: Record<string, any[]>;
  showAuth: boolean;
  previousNodes: Node[];
  selectedPrevNodeId: string;
  selectedInputData: any;
  displayedData: any;
  isPinned: boolean;
  // Event handlers
  handleChange: (key: string, value: any) => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleDrop: (fieldKey: string, setter: React.Dispatch<React.SetStateAction<string>>, e: React.DragEvent, currentValue: string) => void;
  handleDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  getFieldPreview: (fieldKey: string) => string | null;
  setShowAuth: (show: boolean) => void;
  setSelectedPrevNodeId: (id: string) => void;
  handlePanelSave: (newData: any) => void;
  handlePanelPinToggle: () => void;
  fetchCredentials: (fieldKey: string) => void;
  // Style constants
  referenceStyle: React.CSSProperties;
}

const BaseNode: React.FC<BaseNodeProps> = ({ data, selected, children }) => {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const edges = useEdges();
  const { setNodes } = useReactFlow();

  const definition = data.definition || data.config;
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


  const selectedPrevNode = previousNodes.find((n) => n.id === selectedPrevNodeId) || previousNodes[0];
  
  // Extract selectedInputData with the same logic as preview
  let selectedInputData = selectedPrevNode?.data?.output || selectedPrevNode?.data || {};
  // If selectedInputData is an array (from previousNodes), get the first item
  if (Array.isArray(selectedInputData) && selectedInputData.length > 0) {
    selectedInputData = selectedInputData[0] || {};
  }

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
  const [loadingSelect, setLoadingSelect] = useState<Record<string, boolean>>({});
  const [selectOptions, setSelectOptions] = useState<Record<string, any[]>>({});
  const [isSending, setIsSending] = useState(false);
  const [lastOutput, setLastOutput] = useState<any>({ status: "pending" });
  const [overrideOutput, setOverrideOutput] = useState<any | null>(null);
  const [sourceMap, setSourceMap] = useState<Record<string, string>>({});

  const handlePanelSave = useCallback((newData: any) => {
    setOverrideOutput(newData);
    setLastOutput(newData);
    data.output = newData;
  }, [data]);

  const handlePanelPinToggle = useCallback(() => {
    if (overrideOutput == null) {
      setOverrideOutput(lastOutput);
    } else {
      setOverrideOutput(null);
      setLastOutput(data.output || {});
    }
  }, [overrideOutput, lastOutput, data]);

  const displayedData = overrideOutput !== null ? overrideOutput : lastOutput;
  const isPinned = overrideOutput !== null;

  const handleDragStart = (e: React.DragEvent, keyPath: string, value: string) => {
    e.dataTransfer.setData(
      "application/reactflow",
      JSON.stringify({ type: "jsonReference", keyPath, value })
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
                values: { ...((n.data as any)?.values || {}), [key]: value },
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
    console.log("🎯 HANDLE DROP TRIGGERED!", { fieldKey, currentValue });
    console.log("📦 Event types:", Array.from(e.dataTransfer.types));
    console.log("📦 Event effectAllowed:", e.dataTransfer.effectAllowed);
    console.log("📦 Event dropEffect:", e.dataTransfer.dropEffect);
    
    e.preventDefault();
    e.stopPropagation();
    
    try {
      const raw = e.dataTransfer.getData("application/reactflow");
      console.log("📦 Raw data retrieved:", raw);
      
      if (!raw) {
        console.warn("❌ No data found in dataTransfer!");
        // Try alternative data types
        for (const type of e.dataTransfer.types) {
          const altData = e.dataTransfer.getData(type);
          console.log(`📦 Alternative data (${type}):`, altData);
        }
        return;
      }
      
      const data = JSON.parse(raw);
      console.log("📦 Parsed data:", data);
      
      // Handle both old format (direct keyPath) and new format (structured object)
      let keyPath;
      let displayValue;
      
      if (data.type === "jsonReference") {
        keyPath = data.keyPath;
        displayValue = data.value; // Use the actual value for display
      } else {
        keyPath = data.keyPath || data;
        displayValue = data;
      }
      
      const sourceNode = nodes.find((n) => n.id === selectedPrevNodeId);
      const sourceDisplayName = sourceNode
        ? getDisplayName(sourceNode, nodes)
        : definition?.name || 'Node';
      const insert = `{{ $('${sourceDisplayName}').json.${keyPath} }}`;
      const newValue = currentValue + insert;
      
      console.log("✅ Successfully processed drop:", { 
        keyPath, 
        sourceDisplayName, 
        insert, 
        newValue 
      });
      
      setter(newValue);
      handleChange(fieldKey, newValue);
      setSourceMap((sm) => ({ ...sm, [fieldKey]: selectedPrevNodeId }));
    } catch (err) {
      console.error("❌ Drop error:", err);
    }
    
    document.body.classList.remove("cursor-grabbing", "select-none");
  };

  const getFieldPreview = (fieldKey: string) => {
    const expr = fieldState[fieldKey] || "";
    if (!expr.includes("{{")) return null;
    const srcId = sourceMap[fieldKey] || selectedPrevNodeId;
    const srcNode = previousNodes.find((n) => n.id === srcId) || selectedPrevNode;
    
    // Extract the actual data from the node structure
    let srcData = srcNode?.data?.output || srcNode?.data || {};
    
    // If srcData is an array (from previousNodes), get the first item
    if (Array.isArray(srcData) && srcData.length > 0) {
      srcData = srcData[0] || {};
    }
    
    console.log("🔍 Preview Debug:", {
      fieldKey,
      expr,
      srcId,
      srcNode: srcNode?.data,
      srcData,
      selectedPrevNodeId
    });
    
    try {
      const resolved = resolveReferences(expr, srcData);
      console.log("✅ Resolved:", { expr, srcData, resolved });
      return summarizePreview(resolved);
    } catch (error) {
      console.error("❌ Resolution error:", error);
      return "";
    }
  };

  const userId = getUserId();
  console.log("userId", userId)

  const fetchCredentials = async (fieldKey: string) => {
    setLoadingSelect((prev) => ({ ...prev, [fieldKey]: true }));
    try {
      const apiName = (definition?.parentNode || definition?.name || "").toLowerCase();
      
      // Check if userId exists and is valid
      if (!userId || userId.trim() === "") {
        console.log('No user ID available, skipping credentials fetch');
        setSelectOptions((opts) => ({ ...opts, [fieldKey]: [] }));
        return;
      }
      
      const url = `${BACKEND_URL}/${apiName}/credentials?user_id=${userId}`;
      console.log('Fetching credentials from:', url);
      console.log('API name:', apiName, 'User ID:', userId);
      
      const res = await fetch(url);
      console.log('Response status:', res.status);
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const json = await res.json();
      console.log('Credentials response:', json);
      setSelectOptions((opts) => ({ ...opts, [fieldKey]: json.credentials || [] }));
    } catch (error) {
      console.error('Error fetching credentials:', error);
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
  }, [definition?.fields, definition?.name]);

  function collectNodeData() {
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
    console.log("🔧 BuildPayload Debug:", {
      fieldState,
      supportData,
      selectedInputData,
      userId
    });
    
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(fieldState)) {
      const resolvedValue = typeof value === 'string'
        ? resolveReferences(value, selectedInputData)
        : value;
      
      console.log(`🔧 Field ${key}:`, {
        original: value,
        resolved: resolvedValue,
        selectedInputData
      });
      
      payload[key] = resolvedValue;
    }
    return {
      ...payload,
      ...(Array.isArray(supportData) ? supportData[0] || {} : supportData),
      user_id: userId
    };
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    // Validate required fields *only if visible*
    for (const f of definition?.fields || []) {
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
      if (!shouldShow) continue;

      if (f.required && !fieldState[f.key]) {
        setError(`${f.label || f.key} is required`);
        return;
      }
    }
    
    setError("");
    setIsSending(true);

    try {
      const { supportData } = collectNodeData();
      const payload = buildPayload(fieldState, supportData, selectedInputData, userId);
      payload.user_id = userId;

      let outputData: any;
      const operationField = (definition?.fields || []).find((f: any) => f.key === "operation");
      let operationMethod = "POST";
      
      if (operationField) {
        const opSelected = (operationField.options || []).find((opt: any) => opt.id === fieldState.operation);
        if (opSelected && opSelected.method) {
          operationMethod = opSelected.method;
        }
      }

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

      if (definition?.action?.url && definition?.action?.method) {
        let fullUrl = `${BACKEND_URL}${url}`;
        if (method === "GET") {
          const params = new URLSearchParams();
          params.append("user_id", userId);
          params.append("credential_id", fieldState.credential_id ?? "");
          fullUrl += `?${params.toString()}`;
        }

        const fetchOptions: RequestInit = { method };
        if (method !== "GET") {
          fetchOptions.headers = { "Content-Type": "application/json" };
          fetchOptions.body = JSON.stringify(payload);
        }

        const res = await fetch(fullUrl, fetchOptions);
        const responseData = await res.json();
        if (!res.ok) throw new Error(responseData.detail || "Action failed");
        outputData = [responseData];
      } else {
        outputData = [payload];
      }

      setLastOutput(outputData);
      const finalOutput = overrideOutput !== null ? overrideOutput : outputData;
      data.output = finalOutput;

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

  // Listen for auto-execution events
  useEffect(() => {
    const handleAutoExecute = async (event: CustomEvent) => {
      if (event.detail?.nodeId === nodeId) {
        console.log(`🚀 Auto-executing node: ${nodeId}`);
        try {
          await handleSubmit(); // Execute the actual node logic
          // Call success callback if provided
          if (event.detail.onSuccess) {
            event.detail.onSuccess();
          }
        } catch (error) {
          console.error(`❌ Node ${nodeId} execution failed:`, error);
          // Call error callback if provided
          if (event.detail.onError) {
            event.detail.onError(error);
          }
        }
      }
    };

    window.addEventListener('auto-execute-node', handleAutoExecute as EventListener);
    return () => {
      window.removeEventListener('auto-execute-node', handleAutoExecute as EventListener);
    };
  }, [nodeId, handleSubmit]);

  const referenceStyle = {
    backgroundColor: "hsl(var(--muted))",
    borderBottom: "1px dashed hsl(var(--primary))",
  };

  const renderProps: BaseNodeRenderProps = {
    definition,
    displayName,
    fieldState,
    error,
    isSending,
    loadingSelect,
    selectOptions,
    showAuth,
    previousNodes,
    selectedPrevNodeId,
    selectedInputData,
    displayedData,
    isPinned,
    handleChange,
    handleSubmit,
    handleDrop,
    handleDragStart,
    getFieldPreview,
    setShowAuth,
    setSelectedPrevNodeId,
    handlePanelSave,
    handlePanelPinToggle,
    fetchCredentials,
    referenceStyle,
  };

  return <>{children(renderProps)}</>;
};

export default BaseNode;
