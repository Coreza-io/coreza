import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import { WorkflowExecutor } from "@/utils/workflowExecutor";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const BACKEND_URL = "http://localhost:8000";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
const getDisplayName = (node: Node<any>, allNodes: Node<any>[]) => {
  const baseName = node.data.definition?.name;
  const sameType = allNodes.filter((n) => n && n.data && (n.data.definition?.name) === baseName);
  const idx = sameType.findIndex((n) => n.id === node.id);
  const result = idx > 0 ? `${baseName}${idx}` : baseName;
  
  return result;
};


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
  handleFieldStateBatch: (updates: Record<string, any>) => void;
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
  const { setNodes, setEdges } = useReactFlow();
  const { toast } = useToast();
  const { user } = useAuth();
  const isMounted = useRef(true);

  const definition = data.definition;
  const displayName = useMemo(
    () => {
      // Use stored displayName if available, otherwise generate with deduplication
      if (data.displayName && data.displayName !== definition?.name) {
        return data.displayName;
      }
      return getDisplayName({ id: nodeId!, data } as Node<any>, nodes);
    },
    [nodes, definition?.name, nodeId, data.displayName]
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
  
  // Extract selectedInputData with special handling for loop items
  let selectedInputData = selectedPrevNode?.data?.output || selectedPrevNode?.data || {};
  
  // Check if we're in a loop context and prefer loop item data
  if (data?.loopItem) {
    selectedInputData = data.loopItem;
    console.log("🔄 [LOOP DATA] Using loop item as input:", selectedInputData);
  } else if (Array.isArray(selectedInputData) && selectedInputData.length > 0) {
    selectedInputData = selectedInputData[0] || {};
  }

  const [fieldState, setFieldState] = useState<Record<string, any>>(() => {
    if (!definition?.fields) return {};
    return Object.fromEntries(
      definition.fields.map((f: any) => [
        f.key, 
        f.type === "repeater" 
          ? data.fieldState?.[f.key] || data.values?.[f.key] || f.default || []
          : data.fieldState?.[f.key] || data.values?.[f.key] || f.default || ""
      ])
    );
  });

  // Initialize fieldState only once when definition changes, prevent continuous updates
  useEffect(() => {
    if (!definition?.fields) return;
    
    const newFieldState = Object.fromEntries(
      definition.fields.map((f: any) => [
        f.key, 
        f.type === "repeater" 
          ? data.fieldState?.[f.key] || data.values?.[f.key] || f.default || []
          : data.fieldState?.[f.key] || data.values?.[f.key] || f.default || ""
      ])
    );
    
    // Only update if we don't have fieldState initialized yet or if field definitions actually changed
    const isInitializing = Object.keys(fieldState).length === 0;
    const fieldKeysChanged = definition.fields.length !== Object.keys(fieldState).length ||
      definition.fields.some((f: any) => !(f.key in fieldState));
    
    if (isInitializing || fieldKeysChanged) {
      console.log('🔄 BaseNode initializing fieldState for', definition.name);
      setFieldState(newFieldState);
    }
  }, [definition?.fields?.length, definition?.name]); // Stable dependencies

  // Sync fieldState changes to node data.values for proper persistence
  useEffect(() => {
  if (Object.keys(fieldState).length > 0) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                values: { ...fieldState },
              },
            }
          : n
      )
    );
    // Add this:
    console.log('After setNodes from BaseNode', nodeId, fieldState);
  }
}, [fieldState, nodeId, setNodes]);


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

  const handleChange = useCallback((key: string, value: any) => {
    const newFieldState = { ...fieldState, [key]: value };
    setFieldState(newFieldState);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                values: { ...((n.data as any)?.values || {}), [key]: value },
                fieldState: newFieldState,
              },
            }
          : n
      )
    );
  }, [fieldState, nodeId, setNodes]);

   // ========== New batch updater ===========
  const handleFieldStateBatch = useCallback((updates: Record<string, any>) => {
    const newFS = { ...fieldState, ...updates };
    setFieldState(newFS);
    setNodes(nds =>
      nds.map(n => n.id === nodeId
        ? { ...n, data: { ...n.data, values: newFS, fieldState: newFS } }
        : n
      )
    );
  }, [fieldState, nodeId, setNodes]);

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
     
      
      if (!raw) {
        
        // Try alternative data types
        for (const type of e.dataTransfer.types) {
          const altData = e.dataTransfer.getData(type);
          
        }
        return;
      }
      
      const data = JSON.parse(raw);
      
      
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
      const sourceDisplayName = sourceNode.id;
      const insert = `{{ $('${sourceDisplayName}').json.${keyPath} }}`;
      const newValue = currentValue + insert;
      
      
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
    
    // Build allNodeData for cross-node references
    const allNodeData: Record<string, any> = {};
    previousNodes.forEach(prevNode => {
      const displayName = prevNode.id;
      const currentNode = nodes.find(n => n.id === prevNode.id);
      let nodeData = currentNode?.data?.output || currentNode?.data || prevNode.data?.output || prevNode.data || {};
      
      // If nodeData is an array, get the first item
      if (Array.isArray(nodeData) && nodeData.length > 0) {
        nodeData = nodeData[0] || {};
      }
      
      allNodeData[displayName] = nodeData;
    });
    
    try {
      const resolved = resolveReferences(expr, srcData, allNodeData, nodes);
      //console.log("✅ Resolved:", { expr, srcData, allNodeData, resolved });
      return summarizePreview(resolved);
    } catch (error) {
      //console.error("❌ Resolution error:", error);
      return "";
    }
  };

  const userId = user?.id;
  //console.log("userId from auth context:", userId);

  const fetchCredentials = async (fieldKey: string) => {
    setLoadingSelect((prev) => ({ ...prev, [fieldKey]: true }));
    try {
      const apiName = (definition?.subCategory || definition?.parentNode || definition?.name || "").toLowerCase();
      
      // Check if userId exists and is valid
      if (!userId) {
        console.log('No authenticated user, skipping credentials fetch');
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
  function resolveDeep(val: any, selectedInputData: any, allNodeData: any): any {
    if (typeof val === "string") {
      return resolveReferences(val, selectedInputData, allNodeData, nodes);
    }
    if (Array.isArray(val)) {
      return val.map(v => resolveDeep(v, selectedInputData, allNodeData));
    }
    if (typeof val === "object" && val !== null) {
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) => [k, resolveDeep(v, selectedInputData, allNodeData)])
      );
    }
    return val;
  }

  function buildPayload(
    fieldState: Record<string, any>,
    supportData: Record<string, any>,
    selectedInputData: Record<string, any>,
    userId: string
  ): Record<string, any> {
    
    // Create a map of all upstream node data by display name using the most current nodes data
    const allNodeData: Record<string, any> = {};
    
    previousNodes.forEach(prevNode => {
      const displayName = prevNode.id;
      console.log(`🔧 Processing node ${prevNode.id} -> display name: "${displayName}"`);
      
      // Get the most current version of this node from the nodes array
      const currentNode = nodes.find(n => n.id === prevNode.id);
      let nodeData = currentNode?.data?.output || currentNode?.data || prevNode.data?.output || prevNode.data || {};
      
      // If nodeData is an array, get the first item
      if (Array.isArray(nodeData) && nodeData.length > 0) {
        nodeData = nodeData[0] || {};
      }
      allNodeData[displayName] = nodeData;
      console.log(`🔧 Mapped node '${displayName}' -> data:`, nodeData);
    });
    
    console.log("🔧 All node data map:", allNodeData);
    
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(fieldState)) { 
      payload[key] = resolveDeep(value, selectedInputData, allNodeData);
    }
    
    // Special handling for If node to add missing required fields
    if (definition?.name === "If") {
      // Map logicalOps to logicalOp (backend expects singular)
      // If there's only one condition, logicalOps will be empty, so provide a default
      payload.logicalOp = fieldState.logicalOps && fieldState.logicalOps.length > 0 
        ? fieldState.logicalOps[0] 
        : "AND";
      
      // Add inputData as the current available data
      payload.inputData = allNodeData;
      
      console.log("🔧 If node special payload:", payload);
    }
    return {
      ...payload,
      ...(Array.isArray(supportData) ? supportData[0] || {} : supportData),
      user_id: userId
    };
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    // Log the start of execution for all nodes
    console.log("🎯 [NODE EXECUTION] Starting execution for node:", definition?.name || 'Unknown');
    console.log("🎯 [NODE EXECUTION] Current field state:", fieldState);
    
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
      if (!userId) {
        throw new Error("No authenticated user found");
      }
      
      const { supportData } = collectNodeData();
      const payload = buildPayload(fieldState, supportData, selectedInputData, userId);
      payload.user_id = userId;

      let outputData: any;
      
      // Special handling for Loop node - process in frontend without backend call
      if (definition?.name === "Loop") {
        const inputArrayPath = fieldState.inputArray || "items";
        const batchSize = parseInt(fieldState.batchSize) || 1;
        
        // Extract array from selected input data
        let arrayData = selectedInputData;
        if (inputArrayPath.includes('.')) {
          const pathParts = inputArrayPath.split('.');
          for (const part of pathParts) {
            arrayData = arrayData?.[part];
          }
        } else {
          arrayData = arrayData?.[inputArrayPath];
        }
        
        if (!Array.isArray(arrayData)) {
          throw new Error(`Field "${inputArrayPath}" is not an array or does not exist`);
        }
        
        outputData = {
          isLoopNode: true,
          items: arrayData,
          batchSize: batchSize,
          totalItems: arrayData.length
        };
        
        console.log("🔄 [LOOP NODE] Frontend processing complete:", outputData);
      } else {
        // Regular backend processing for non-Loop nodes
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
          let params: URLSearchParams | undefined;
          
          if (method === "GET") {
            params = new URLSearchParams();
            params.append("user_id", userId);
            params.append("credential_id", fieldState.credential_id ?? "");
            fullUrl += `?${params.toString()}`;
          }

          const fetchOptions: RequestInit = { method };
          if (method !== "GET") {
            fetchOptions.headers = { "Content-Type": "application/json" };
            fetchOptions.body = JSON.stringify(payload);
          }

          // Log the payload and request details
          console.log("🚀 [BACKEND REQUEST] Sending to:", fullUrl);
          console.log("🚀 [BACKEND REQUEST] Method:", method);
          console.log("🚀 [BACKEND REQUEST] Payload:", JSON.stringify(payload, null, 2));
          if (method === "GET" && params) {
            console.log("🚀 [BACKEND REQUEST] GET params:", params.toString());
          }

          const res = await fetch(fullUrl, fetchOptions);
          const responseData = await res.json();
          if (!res.ok) throw new Error(responseData.detail || "Action failed");
          outputData = [responseData];
        } else {
          outputData = [payload];
        }
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

      // After creating loop results, run downstream nodes sequentially
      if (definition?.name === "Loop") {
        const workflowExecutor = new WorkflowExecutor({
          nodes,
          edges,
          setNodes,
          setEdges,
          setExecutingNode: () => {},
          toast,
        });
        const outgoing = edges.filter((e) => e.source === nodeId);
        await workflowExecutor.handleLoopExecution(
          nodeId!,
          outputData,
          outgoing,
          new Set([nodeId!])
        );
      }
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
        
        // Check if this node is a conditional target (should only execute when explicitly triggered)
        if (event.detail.allEdges && event.detail.allNodes) {
          const incomingEdges = event.detail.allEdges.filter((edge: any) => edge.target === nodeId);
          const isConditionalTarget = incomingEdges.some((edge: any) => {
            const sourceNode = event.detail.allNodes.find((n: any) => n.id === edge.source);
            return sourceNode && 
                   (sourceNode.data?.definition as any)?.name === "If" && 
                   (edge.sourceHandle === 'true' || edge.sourceHandle === 'false');
          });
          
          // If this is a conditional target and wasn't explicitly triggered by the If node, skip execution
          if (isConditionalTarget && !event.detail.explicitlyTriggered) {
            console.log(`🚫 Node ${nodeId} is a conditional target, skipping auto-execution (waiting for explicit trigger)`);
            return;
          }
        }
        
        // Check if all input dependencies have completed
        if (event.detail.executedNodes && event.detail.allEdges) {
          const incomingEdges = event.detail.allEdges.filter((edge: any) => edge.target === nodeId);
          const dependencies = incomingEdges.map((edge: any) => edge.source);
          
          console.log(`🔍 Node ${nodeId} dependencies:`, dependencies);
          console.log(`🔍 Node ${nodeId} executed nodes:`, Array.from(event.detail.executedNodes));
          
          // For nodes without dependencies, allow immediate execution
          if (dependencies.length === 0) {
            console.log(`✅ Node ${nodeId} has no dependencies, proceeding with execution`);
          } else {
            const allDependenciesCompleted = dependencies.every(dep => event.detail.executedNodes.has(dep));
            
            if (!allDependenciesCompleted) {
              const pendingDeps = dependencies.filter(dep => !event.detail.executedNodes.has(dep));
              console.log(`⏳ Node ${nodeId} waiting for dependencies:`, pendingDeps);
              return; // Don't retry, let the workflow manager handle execution order
            }
          }
        }
        
        console.log(`✅ All dependencies ready for node: ${nodeId}, proceeding with execution`);
        
        let timeoutId: NodeJS.Timeout;
        
        try {
          // Execute the node logic and capture the result
          await handleSubmit();
          
          // Get the result immediately after handleSubmit completes
          const currentNode = nodes.find(n => n.id === nodeId);
          const actualResult = currentNode?.data?.output;
          
          console.log(`✅ Node ${nodeId} executed successfully with result:`, actualResult);
          
          // For If nodes and other nodes, extract the first item from the array if it's an array
          let resultToPass = actualResult;
          if (Array.isArray(actualResult) && actualResult.length > 0) {
            resultToPass = actualResult[0];
          }
          
          // Special handling for Switch/comparator nodes
          const nodeType = definition?.name;
          if (nodeType === 'Switch' && resultToPass && typeof resultToPass === 'object' && 'result' in resultToPass) {
            resultToPass = resultToPass.result; // Extract the 'result' field
          }
          
          // Call success callback immediately with the result
          if (event.detail.onSuccess) {
            event.detail.onSuccess(resultToPass);
          }
        } catch (executionError) {
          console.error(`❌ Node ${nodeId} execution failed:`, executionError);
          // Clear timeout on error
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          // Call error callback if provided
          if (event.detail.onError) {
            event.detail.onError(executionError);
          }
        }
      }
    };

    window.addEventListener('auto-execute-node', handleAutoExecute as EventListener);
    return () => {
      isMounted.current = false;
      window.removeEventListener('auto-execute-node', handleAutoExecute as EventListener);
    };
  }, [nodeId, handleSubmit, error, lastOutput]);

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
    handleFieldStateBatch,
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
