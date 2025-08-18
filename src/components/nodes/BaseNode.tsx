import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { resolveReferences } from "@/utils/resolveReferences";
import { summarizePreview } from "@/utils/summarizePreview";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";

const BACKEND_URL = "http://localhost:8000";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
const getDisplayName = (node: Node<any>, allNodes: Node<any>[]) => {
  const baseName = node.data.definition?.name;
  const sameType = allNodes.filter((n) => n && n.data && (n.data.definition?.name) === baseName);
  const idx = sameType.findIndex((n) => n.id === node.id);
  const result = idx > 0 ? `${baseName}${idx}` : baseName;
  
  return result;
};

const makeArraySignature = (arr: any[]): string => {
  try {
    const first = arr.length ? JSON.stringify(arr[0]) : "";
    const last  = arr.length ? JSON.stringify(arr[arr.length - 1]) : "";
    return `${arr.length}|${first}|${last}`;
  } catch {
    return `${arr.length}`;
  }
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
  // Node name editing
  isEditing: boolean;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement>;
  startEditing: () => void;
  finishEditing: (save?: boolean) => void;
  setEditingName: (name: string) => void;
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
  const { setNodes } = useReactFlow();
  const { setEdges } = useReactFlow();
  const { toast } = useToast();
  const { user, session } = useAuth();
  const executionStore = useExecutionStore();
  const isMounted = useRef(true);

  // === NEW: refs for event-driven callbacks ===
  const onSuccessRef = useRef<null | ((result: any) => void)>(null);
  const onErrorRef = useRef<null | ((error: any) => void)>(null);

  const definition = data.definition;
  const displayName = useMemo(
    () => {
      // Use custom displayName if available, otherwise generate with deduplication
      if (data.displayName && data.displayName.trim()) {
        return data.displayName;
      }
      return getDisplayName({ id: nodeId!, data } as Node<any>, nodes);
    },
    [nodes, definition?.name, nodeId, data.displayName]
  );

  // State for inline editing
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

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

  // Node name editing functionality - with race condition protection
  const startEditing = useCallback(() => {
    if (isEditing) return; // Prevent double activation
    setEditingName(displayName);
    setIsEditing(true);
  }, [displayName, isEditing]);

  const finishEditing = useCallback((save: boolean = true) => {
    if (save && editingName.trim() && editingName.trim() !== displayName) {
      const trimmedName = editingName.trim();
      
      // Validation: Check for invalid characters and length
      if (trimmedName.length > 50) {
        toast({
          title: "Name too long",
          description: "Node name must be 50 characters or less",
          variant: "destructive",
        });
        return;
      }
      
      if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedName)) {
        toast({
          title: "Invalid characters",
          description: "Node name can only contain letters, numbers, spaces, hyphens, and underscores",
          variant: "destructive",
        });
        return;
      }
      
      // Check for name uniqueness across all nodes (both IDs and displayNames)
      const existingNames = nodes
        .filter(n => n.id !== nodeId)
        .map(n => n.data?.displayName || n.id)
        .filter((name): name is string => typeof name === 'string')
        .map(name => name.toLowerCase());

      let finalName = trimmedName;
      if (existingNames.includes(finalName.toLowerCase())) {
        let counter = 1;
        while (existingNames.includes(`${finalName}${counter}`.toLowerCase())) {
          counter++;
        }
        finalName = `${finalName}${counter}`;
      }

      const oldNodeId = nodeId!;
      const newNodeId = finalName;

      // Update node with new ID and display name (N8N behavior)
      setNodes(prevNodes => {
        return prevNodes.map(node => {
          if (node.id === oldNodeId) {
            return {
              ...node,
              id: newNodeId,
              data: {
                ...node.data,
                displayName: finalName
              }
            };
          }
          return node;
        });
      });

      // Update all edges that reference the old node ID
      setEdges(prevEdges => {
        return prevEdges.map(edge => {
          let updatedEdge = { ...edge };
          if (edge.source === oldNodeId) {
            updatedEdge.source = newNodeId;
          }
          if (edge.target === oldNodeId) {
            updatedEdge.target = newNodeId;
          }
          // Update edge ID if it contains the old node ID
          if (edge.id.includes(oldNodeId)) {
            updatedEdge.id = edge.id.replace(oldNodeId, newNodeId);
          }
          return updatedEdge;
        });
      });

      toast({
        title: "Node renamed",
        description: `Node renamed to "${finalName}"`,
      });
    }
    
    setIsEditing(false);
    setEditingName('');
  }, [editingName, displayName, nodeId, nodes, setNodes, setEdges, toast]);

  // F2 key handler - scoped to only this node when selected
  useEffect(() => {
    if (!selected) return; // Only add listener when node is selected
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent conflicts with input fields and other editing states
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      if (e.key === 'F2' && !isEditing) {
        e.preventDefault();
        e.stopPropagation();
        startEditing();
      } else if (isEditing) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finishEditing(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finishEditing(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selected, isEditing, startEditing, finishEditing]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);


  const selectedPrevNode = previousNodes.find((n) => n.id === selectedPrevNodeId) || previousNodes[0];

  // Extract selectedInputData prioritizing execution store data
  const storeEntry = nodeId ? executionStore.getNodeData(nodeId) : {};
  let selectedInputData = selectedPrevNode?.data?.output ?? {};

  // Prefer loop item from execution store if present
  //if (storeEntry.loopItem !== undefined) {
  //  selectedInputData = storeEntry.loopItem;
  //  console.log("🔄 [LOOP DATA] Using loop item as input:", selectedInputData);
  //}
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
    
    // Build new field state from definition fields
    const newFieldStateFromDefinition = Object.fromEntries(
      definition.fields.map((f: any) => [
        f.key, 
        f.type === "repeater" 
          ? data.fieldState?.[f.key] || data.values?.[f.key] || f.default || []
          : data.fieldState?.[f.key] || data.values?.[f.key] || f.default || ""
      ])
    );
    
    // Preserve any existing data that's not in the definition (for backward compatibility)
    const existingExtraData = Object.fromEntries(
      Object.entries(data.fieldState || {}).filter(([key]) => 
        !definition.fields.some((f: any) => f.key === key)
      )
    );
    const existingExtraValues = Object.fromEntries(
      Object.entries(data.values || {}).filter(([key]) => 
        !definition.fields.some((f: any) => f.key === key) &&
        !(key in existingExtraData)
      )
    );
    
    const newFieldState = {
      ...newFieldStateFromDefinition,
      ...existingExtraData,
      ...existingExtraValues
    };
    
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
      const sourceDisplayName = sourceNode?.data?.displayName || sourceNode?.id;
      const kp = (keyPath ?? "").trim();
      const suffix = kp ? `.${kp}` : "";
      const insert = `{{ $('${sourceDisplayName}').json${suffix} }}`;
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
    
    
    // Build allNodeData for cross-node references
    const allNodeData: Record<string, any> = {};
    previousNodes.forEach(prevNode => {
      const displayName = prevNode.data?.displayName || prevNode.id;
      // Prefer execution store
      let nodeData = executionStore.getNodeData(prevNode.id).output;
      if (nodeData === undefined) {
        // fallback to static data if not yet executed
        nodeData = prevNode.data?.output || prevNode.data || {};
      }

      if (typeof displayName === 'string') {
        allNodeData[displayName] = nodeData;
      }
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
      
      // Use credentials API for security  
      const url = `${BACKEND_URL}/credentials/list?service_type=${apiName}`;
      console.log('Fetching credentials from:', url);
      console.log('API name:', apiName, 'User ID:', userId);
      
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'user-id': userId
        }
      });
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
      // Prefer execution store
      let nodeData = executionStore.getNodeData(prevNode.id).output;
      if (nodeData === undefined) {
        // fallback to static data if not yet executed
        nodeData = prevNode.data?.output || prevNode.data || {};
      }

      allNodeData[displayName] = nodeData;
    });

    
    console.log("🔧 All node data map:", allNodeData);
    
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(fieldState)) { 
      payload[key] = resolveDeep(value, selectedInputData, allNodeData);
    }
    
    // Special handling for If node to add missing required fields
    if (definition?.name === "If") {
      // Use the logicalOp field directly from fieldState (now it's a proper field)
      // Default to "AND" if not set
      payload.logicalOp = fieldState.logicalOp;
      
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

  const handleSubmit = async (e?: React.FormEvent, inputOverride?: any) => {
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
      //let effectiveInput = inputOverride ?? selectedInputData;
      let effectiveInput = selectedInputData;
      if (
        //!inputOverride &&
        (!effectiveInput || Object.keys(effectiveInput).length === 0)
      ) {
        // Root node with no prior input: default to fieldState (the node's form values)
        effectiveInput = { ...fieldState };
      }
      const payload = buildPayload(fieldState, supportData, effectiveInput, userId);
      payload.user_id = userId;

      let outputData: any;

      if (definition?.name === "Loop") {
        const batchSize       = parseInt(fieldState.batchSize) || 1;
        const parallel        = !!fieldState.parallel;
        const aggregateMode   = !!fieldState.aggregate;
        const continueOnError = !!fieldState.continueOnError;
        const throttleMs      = parseInt(fieldState.throttleMs) || 200;

        // 1) normalize input → loopItems
        let loopItems: any[];
        if (Array.isArray(payload.inputArray )) loopItems = payload.inputArray;
        else if (typeof payload.inputArray === "string") {
          const parsed = JSON.parse(payload.inputArray as any);
          loopItems = Array.isArray(parsed) ? parsed : [parsed];
        } else if (payload.inputArray == null) loopItems = [];
        else if (typeof payload.inputArray === "object") loopItems = [payload.inputArray];
        else throw new Error("Loop input must be an array or JSON string representing an array");

        // 3) init / resume state
        const loopSig = makeArraySignature(loopItems);
        const prev = executionStore.getNodeData(nodeId!) || {};
        const inputChanged =
          !Array.isArray(prev.loopItems) ||
          (prev.loopSig ?? "") !== loopSig;

        if (inputChanged) {
          executionStore.startLoop(nodeId!, loopItems, {
            batchSize, parallel, continueOnError, throttleMs,
            loopSig, aggregateMode,
          });
        } else {
          executionStore.setNodeData(nodeId!, {
            batchSize, parallel, continueOnError, throttleMs,
            aggregateMode
          });
        }

        const st = executionStore.getNodeData(nodeId!);
        const items = st.loopItems || loopItems;

        // 5) next batch & state update
        const arrayLength = items.length;
        const maxLoopIndex = Math.ceil(arrayLength / batchSize) - 1;
        let loopIndex = st.loopIndex ?? 0;
        // Cap the loopIndex so it doesn't exceed maxLoopIndex
        let finished = false;
        //const endIndex = Math.min(start + batchSize, arrayLength);
        let startIndex = loopIndex;
        let currentIndex = loopIndex;
        if (aggregateMode) {
          startIndex = 0;
        }
        let endIndex = currentIndex + batchSize;
        const batch = items.slice(startIndex, endIndex);
        let current  = batchSize === 1 ? batch[0] : batch;
        current  = !aggregateMode? batch[0] : batch;

        const incomingToLoop = edges.filter(e => e.target === nodeId!);
        const loopDataNow = executionStore.getNodeData(nodeId!) || {};
        const edgeBuf: Record<string, any> = loopDataNow._edgeBuf ?? {};
        const edgeArrivals = incomingToLoop.map(e => edgeBuf[e.id]).filter(v => v != null);

        if (loopIndex > maxLoopIndex) {
          finished = true;
          const next = executionStore.advanceLoop(nodeId!, current, loopIndex + 1, finished, edgeArrivals);
          const finalOut = next.aggregated ?? edgeArrivals ?? [];
          executionStore.setNodeData(nodeId!, {
            output: finalOut,
            loopItems: undefined,
            loopIndex: 0,
            loopItem: undefined,
            finishedByLoop: true,
            done: true,
            _edgeBuf: {},
          });
          setLastOutput(finalOut);
          data.output = finalOut;
          setNodes(nds => nds.map(n =>
            n.id === nodeId ? ({ ...n, data: { ...n.data, output: finalOut } }) : n
          ));
          outputData = finalOut;
          return;
        }

        // items mode → append emitted items and finalize to full aggregate on last batch
        const next = executionStore.advanceLoop(nodeId!, current, loopIndex + 1, finished, edgeArrivals);
        const uiOut = next.output; // current batch until final, then full aggregate
        setLastOutput(uiOut);
        data.output = uiOut;
        setNodes(nds => nds.map(n =>
          n.id === nodeId ? ({ ...n, data: { ...n.data, output: uiOut } }) : n
        ));

        executionStore.setNodeData(nodeId!, { input: effectiveInput, output: uiOut, _edgeBuf: {} });

        return;
      }

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
        outputData = responseData;
      } else {
        outputData = payload;
      }

      setLastOutput(outputData);
      const finalOutput = overrideOutput !== null ? overrideOutput : outputData;
      data.output = finalOutput;
      executionStore.setNodeData(nodeId!, { input: effectiveInput, output: finalOutput });
      //executionStore.setNodeData(nodeId!, { output: finalOutput });
      setNodes(nds =>
        nds.map(n =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, output: finalOutput } }
            : n
        )
      );
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
  // Refs for stashing callbacks (place these at the top of your component)
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
          //if (isConditionalTarget && !event.detail.explicitlyTriggered) {
          //  console.log(`🚫 Node ${nodeId} is a conditional target, skipping auto-execution (waiting for explicit trigger)`);
          //  return;
          //}
        }

        // === Stash callbacks for use in [nodes] effect ===
        onSuccessRef.current = event.detail.onSuccess ?? null;
        onErrorRef.current = event.detail.onError ?? null;

        try {
          const inputData = nodeId
            ? executionStore.getNodeData(nodeId).input
            : undefined;
          await handleSubmit(undefined, inputData);
          // Don't access nodes/output or call callback here!
        } catch (executionError) {
          onErrorRef.current?.(executionError);
          onSuccessRef.current = onErrorRef.current = null;
        }
      }
    };

    window.addEventListener('auto-execute-node', handleAutoExecute as EventListener);
    return () => {
      isMounted.current = false;
      window.removeEventListener('auto-execute-node', handleAutoExecute as EventListener);
    };
  }, [nodeId, handleSubmit]);

  useEffect(() => {
    const currentNode = nodes.find(n => n.id === nodeId);
    if (!currentNode || !onSuccessRef.current) return;

    const output = currentNode.data?.output;
    if (output === undefined) return;

    // Normalize result as needed
    let resultToPass = output;
    
    // Only normalize for Switch nodes that need special handling
    if (definition?.name === 'Switch' && resultToPass && typeof resultToPass === 'object' && 'result' in resultToPass) {
      resultToPass = resultToPass.result;
    }

    // Call the stashed success callback
    onSuccessRef.current?.(resultToPass);
    onSuccessRef.current = onErrorRef.current = null;
  }, [nodes, nodeId, definition]);

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
    // Node name editing
    isEditing,
    editingName,
    editInputRef,
    startEditing,
    finishEditing,
    setEditingName,
    // Event handlers
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
