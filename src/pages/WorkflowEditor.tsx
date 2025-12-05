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

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ReactFlow,
  addEdge,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  NodeChange,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ConnectionLineType,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Save,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Zap,
  History,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { NodePalette } from "@/components/workflow/NodePalette";
import EdgeManager from "@/components/workflow/EdgeManager";
import { LoopNode, LoopNodeData } from "@/components/workflow/LoopNode";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useExecutionHistory } from "@/hooks/useExecutionHistory";
import { ExecutionHistoryPanel } from "@/components/workflow/ExecutionHistoryPanel";
import { ExecutionDetailView } from "@/components/workflow/ExecutionDetailView";

// Import node types
import NodeRouter from "@/components/nodes/NodeRouter";
import { nodeManifest } from "@/nodes/manifest";
import { WorkflowExecutor } from "@/utils/workflowExecutor";
import {
  ExecutionStoreProvider,
  useExecutionStore,
} from "@/contexts/ExecutionStoreContext";
import { appendNewsItem, createWaitingNewsOutput } from "@/utils/alpacaNews";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { cn } from "@/lib/utils";

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const resolveWebSocketUrl = (): string | null => {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) {
    return explicit;
  }

  try {
    const api = new URL(API_BASE_URL);
    const configuredPort = import.meta.env.VITE_WS_PORT as string | undefined;
    const wsProtocol = api.protocol === "https:" ? "wss:" : "ws:";
    const port =
      configuredPort ??
      (api.port ? (api.port === "8000" ? "8080" : api.port) : "8080");
    return `${wsProtocol}//${api.hostname}:${port}`;
  } catch (error) {
    console.error("Failed to derive WebSocket URL", error);
    return null;
  }
};

const parseSymbolsValue = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s): s is string => Boolean(s));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
};

// Base node type mapping (excluding custom Loop node)
const baseNodeTypes = Object.fromEntries([
  // Map by manifest keys (skip Loop; it'll use a custom component)
  ...Object.keys(nodeManifest)
    .filter((nodeKey) => nodeKey !== "Loop")
    .map((nodeKey) => [nodeKey, NodeRouter]),
  // Map by node name values (for proper type mapping)
  ...Object.values(nodeManifest).map((nodeDef: any) => [
    nodeDef.name,
    NodeRouter,
  ]),
]);

//console.log("Available nodeTypes:", Object.keys(nodeTypes));
//console.log("NodeManifest keys:", Object.keys(nodeManifest));

const edgeTypes = {
  default: EdgeManager.PlugEdge,
  loop: EdgeManager.LoopEdge,
  removable: EdgeManager.DefaultEdge,
};

// Initial nodes for demonstration
const initialNodes: Node[] = [
  {
    id: "hello-node",
    type: "FinnHub", // Use the manifest key, not node_type
    position: { x: 100, y: 100 },
    data: {
      label: "Welcome to Coreza!",
      definition: nodeManifest.FinnHub,
    },
  },
];

const initialEdges: Edge[] = [];

const WorkflowEditorContent = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: authUser, session, loading: authLoading } = useAuth();
  const executionStore = useExecutionStore();
  const wsRef = useRef<WebSocket | null>(null);
  const messageHandlerRef = useRef<
    (rawPayload: any, timestamp?: string) => void
  >(() => {});
  const resolvedTheme = useResolvedTheme();

  // CRITICAL FIX: Make isNewWorkflow reactive to URL changes
  const isNewWorkflow = id === "new" || !id;
  const projectId = searchParams.get("project"); // Get project ID from URL parameters

  const [workflowId, setWorkflowId] = useState<string | null>(
    isNewWorkflow ? null : id || null
  );

  // CRITICAL FIX: Sync workflowId with URL parameter changes
  useEffect(() => {
    if (!isNewWorkflow && id !== workflowId) {
      //console.log("🔄 Syncing workflowId with URL:", { oldWorkflowId: workflowId, newId: id });
      setWorkflowId(id || null);
    }
  }, [id, isNewWorkflow, workflowId]);
  const [workflowName, setWorkflowName] = useState(
    isNewWorkflow ? "My workflow 1" : "Existing Workflow"
  );
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPaletteVisible, setIsPaletteVisible] = useState(true);
  const [executingNode, setExecutingNode] = useState<string | null>(null);
  const [isAutoExecuting, setIsAutoExecuting] = useState(false);
  const [executionQueue, setExecutionQueue] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"editor" | "executions">("editor");
  
  // Execution history hook
  const {
    executions,
    loading: executionsLoading,
    loadingMore,
    hasMore,
    loadMore,
    selectedExecution,
    setSelectedExecution,
    autoRefresh,
    setAutoRefresh,
    refresh: refreshExecutions,
    getDuration,
    getNodeExecutions,
  } = useExecutionHistory(workflowId);

  const [nodes, setNodes, applyNodeChanges] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rf = useReactFlow();
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 400, y: 300 });
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);

  const cloneNodes = useCallback((sourceNodes: Node[]) => {
    return sourceNodes.map((node) => ({
      ...node,
      data: { ...node.data },
    }));
  }, []);

  const cloneEdges = useCallback((sourceEdges: Edge[]) => {
    return sourceEdges.map((edge) => ({
      ...edge,
      data: { ...edge.data },
    }));
  }, []);

  const saveHistorySnapshot = useCallback(() => {
    historyRef.current.push({
      nodes: cloneNodes(nodes),
      edges: cloneEdges(edges),
    });
  }, [cloneEdges, cloneNodes, edges, nodes]);

  // Inject execution state into node data for visual feedback
  useEffect(() => {
    if (nodes.length === 0) return;

    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isExecuting: executingNode === node.id,
        },
      }))
    );
  }, [executingNode]);

  const cleanupAlpacaSubscription = useCallback(
    async (
      nodeId: string,
      fallbackSymbols: string[] = [],
      updateNodeState: boolean = true
    ) => {
      if (!authUser) {
        return;
      }

      const storeData = executionStore.getNodeData(nodeId) as any;
      const storedSymbols = Array.isArray(storeData?.output?.symbols)
        ? storeData.output.symbols
        : [];
      const symbols = storedSymbols.length ? storedSymbols : fallbackSymbols;

      if (symbols.length) {
        try {
          await fetch(`${API_BASE_URL}/alpaca-news/unsubscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: authUser.id,
              symbols,
              node_id: nodeId,
            }),
          });
        } catch (error) {
          console.error(
            "Failed to unsubscribe Alpaca news for node",
            nodeId,
            error
          );
        }
      }

      const waitingOutput = createWaitingNewsOutput({
        nodeId,
        symbols: [],
      });
      executionStore.setNodeData(nodeId, { output: waitingOutput });

      if (updateNodeState) {
        setNodes((prev) =>
          prev.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, output: waitingOutput } }
              : node
          )
        );
      }
    },
    [authUser?.id, executionStore, setNodes]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removedNodeIds = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);

      if (removedNodeIds.length) {
        removedNodeIds.forEach((id) => {
          const removedNode = nodes.find((node) => node.id === id);
          const nodeName = (removedNode?.data?.definition as any)?.name;
          if (nodeName === "AlpacaNews") {
            const nodeData = removedNode.data as any;
            const candidateSymbols =
              executionStore.getNodeData(id)?.output?.symbols ??
              nodeData?.output?.symbols ??
              nodeData?.values?.symbols ??
              nodeData?.fieldState?.symbols;
            cleanupAlpacaSubscription(
              id,
              parseSymbolsValue(candidateSymbols),
              false
            );
          }
        });
      }

      applyNodeChanges(changes);
    },
    [applyNodeChanges, cleanupAlpacaSubscription, executionStore, nodes]
  );

  const handleNodeOutputMessage = useCallback(
    (rawPayload: any, timestamp?: string) => {
      if (!rawPayload) {
        return;
      }

      const nodeId = rawPayload.nodeId || rawPayload.node_id;
      const newsData =
        rawPayload.data ||
        rawPayload.news ||
        rawPayload.payload?.data ||
        rawPayload.payload ||
        rawPayload;

      if (!nodeId || !newsData) {
        return;
      }

      const receivedAt =
        rawPayload.receivedAt || timestamp || new Date().toISOString();
      const symbols = parseSymbolsValue(
        rawPayload.symbols ?? newsData.symbols ?? []
      );

      const currentData = executionStore.getNodeData(nodeId) as any;
      const nextOutput = appendNewsItem(currentData?.output, newsData, {
        nodeId,
        symbols,
        receivedAt,
      });

      executionStore.setNodeData(nodeId, { output: nextOutput });
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, output: nextOutput } }
            : node
        )
      );
    },
    [executionStore, setNodes]
  );

  useEffect(() => {
    // Keep the message handler stable without forcing WS reconnections
    messageHandlerRef.current = handleNodeOutputMessage;
  }, [handleNodeOutputMessage]);

  const removeEdge = useCallback(
    (edgeId: string) => setEdges((es) => es.filter((e) => e.id !== edgeId)),
    [setEdges]
  );

  // Handle "+" click on Loop node to add a new downstream node
  const handleAddNode = useCallback(
    (loopNodeId: string) => {
      const position = rf.getNode(loopNodeId)?.position || { x: 0, y: 0 };
      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: "default",
        position: { x: position.x + 200, y: position.y },
        data: { label: "New Node" },
      };
      setNodes((ns) => [...ns, newNode]);

      const edgeId = `edge_${loopNodeId}_${newNode.id}`;
      const newEdge: Edge = {
        id: edgeId,
        source: loopNodeId,
        sourceHandle: "done",
        target: newNode.id,
        type: "removable",
        data: { onRemoveEdge: () => removeEdge(edgeId) },
      };
      setEdges((es) => [...es, newEdge]);
    },
    [rf, setNodes, setEdges, removeEdge]
  );

  const handleRemoveLoop = useCallback(
    (loopNodeId: string) => {
      setEdges((es) =>
        es.filter((e) => e.source !== loopNodeId && e.target !== loopNodeId)
      );
    },
    [setEdges]
  );

  useEffect(() => {
    const wsUrl = resolveWebSocketUrl();
    if (!authUser?.id || !session?.access_token || !wsUrl) {
      return;
    }

    // Prevent duplicate connections on rapid re-renders
    if (wsRef.current) {
      return;
    }

    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let closedByEffect = false;

    const connect = () => {
      const socket = new WebSocket(`${wsUrl}?token=${session.access_token}`);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log("🔌 Alpaca news WebSocket connected");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (!message?.type) {
            return;
          }

          if (message.type === "node_output") {
            messageHandlerRef.current(message.payload, message.timestamp);
          } else if (message.type === "alpaca_news") {
            const payload = message.payload || {};
            messageHandlerRef.current(
              {
                nodeId: payload.nodeId || payload.node_id,
                data: payload.news ?? payload,
                symbols:
                  payload.news?.symbols ??
                  payload.symbols ??
                  payload.data?.symbols,
                receivedAt: message.timestamp,
              },
              message.timestamp
            );
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message", error);
        }
      };

      socket.onerror = (event) => {
        console.error("Alpaca news WebSocket error", event);
        socket.close();
      };

      socket.onclose = () => {
        wsRef.current = null;
        if (!closedByEffect) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, "navigate/cleanup");
        } catch (e) {
          console.log(e, "ERROR");
        }
        wsRef.current = null;
      }
    };
  }, [authUser?.id, session?.access_token]);

  // Merge base node types with custom Loop node
  const nodeTypes = useMemo(
    () => ({
      ...baseNodeTypes,
      Loop: (props: any) => (
        <LoopNode
          {...props}
          data={{ ...(props.data as LoopNodeData), onAddNode: handleAddNode }}
        />
      ),
    }),
    [handleAddNode]
  );

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) => {
        const id = `edge_${Date.now()}`;
        const newEdge: Edge = {
          id,
          ...params,
          type: "removable",
          data: { onRemoveEdge: () => removeEdge(id) },
        };
        return addEdge(newEdge, eds);
      }),
    [removeEdge, setEdges]
  );

  // Memoized WorkflowExecutor instance - only recreate when structure changes
  const workflowExecutor = useMemo(() => {
    if (nodes.length === 0) return null;

    return new WorkflowExecutor({
      nodes,
      edges,
      setNodes,
      setEdges,
      setExecutingNode,
      toast,
      executionStore,
    });
  }, [
    nodes.length,
    edges.length,
    setNodes,
    setEdges,
    setExecutingNode,
    toast,
    executionStore,
  ]);

  // Execute all nodes with the queue-based WorkflowExecutor
  const executeAllNodes = useCallback(async () => {
    if (!workflowExecutor) {
      toast({
        title: "Error",
        description: "No workflow to execute",
        variant: "destructive",
      });
      return;
    }

    setIsAutoExecuting(true);
    await workflowExecutor.executeAllNodes();
    setIsAutoExecuting(false);
  }, [workflowExecutor, toast]);

  // Handle node double click to execute
  // Double click to execute one node only (optional: show highlight/animation)
  const onNodeDoubleClick = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      await workflowExecutor.executeNode(node.id, new Set());
    },
    [workflowExecutor]
  );

  // Save workflow to Supabase
  const handleSaveWorkflow = async () => {
    if (!authUser) {
      return;
    }

    // 1) Turn each node into a "minimal" version without its definition
    const minimalNodes = nodes.map((n) => ({
      id: n.id,
      name: (n.data.definition as any)?.name,
      node_type: (n.data.definition as any)?.node_type,
      category: (n.data.definition as any)?.category,
      subCategory: (n.data.definition as any)?.subCategory,
      position: n.position,
      sourcePosition: n.sourcePosition,
      targetPosition: n.targetPosition,
      // ONLY keep the user's inputs + last output (or whatever you actually need)
      values: n.data.values,
      executionMode: (n.data.definition as any)?.executionMode,
      streamingConfig: (n.data.definition as any)?.streamingConfig,
      // Save display name information for reference resolution
      //displayName: (n.data.values as any)?.label || (n.data.definition as any)?.name || n.type
    }));

    // Get existing node IDs
    const existingNodeIds = new Set(minimalNodes.map((node) => node.id));

    // Clean edges by removing execution-related properties and filter out edges to non-existent nodes
    const cleanEdges = edges
      .filter(
        (edge) =>
          existingNodeIds.has(edge.source) && existingNodeIds.has(edge.target)
      )
      .map((edge) => {
        const cleanEdge: any = {
          id: edge.id,
          type: edge.type,
          source: edge.source,
          target: edge.target,
        };

        // Only include handles if they exist
        if (edge.sourceHandle) cleanEdge.sourceHandle = edge.sourceHandle;
        if (edge.targetHandle) cleanEdge.targetHandle = edge.targetHandle;

        // Only include basic style properties (no execution styling)
        if (edge.style?.strokeLinecap || edge.style?.strokeLinejoin) {
          cleanEdge.style = {
            strokeLinecap: edge.style?.strokeLinecap || "round",
            strokeLinejoin: edge.style?.strokeLinejoin || "round",
          };
        }

        return cleanEdge;
      });

    const payload = {
      user_id: authUser.id,
      name: workflowName,
      nodes: JSON.parse(JSON.stringify(minimalNodes)) as any,
      edges: JSON.parse(JSON.stringify(cleanEdges)) as any,
      updated_at: new Date().toISOString(),
      ...(projectId && { project_id: projectId }), // Include project_id if available
    };
    console.log("payload", payload);

    if (workflowId) {
      const { error } = await supabase
        .from("workflows")
        .update(payload)
        .eq("id", workflowId);
    } else {
      const { data, error } = await supabase
        .from("workflows")
        .insert([payload])
        .select()
        .single();
      if (data) {
        setWorkflowId(data.id);

        // CRITICAL FIX: Use React Router's navigate instead of window.history
        // This ensures useParams() updates properly
        // Route workflow URLs through the authenticated dashboard layout
        const workflowPath = `/dashboard/workflow/${data.id}`;
        const newUrl = projectId
          ? `${workflowPath}?project=${projectId}`
          : workflowPath;

        navigate(newUrl, { replace: true });

        toast({
          title: "Success",
          description: "Workflow saved!",
        });
      } else {
        toast({
          title: "Error",
          description: "Error saving: " + error.message,
          variant: "destructive",
        });
      }
    }
  };

  const handleActivate = async () => {
    if (!authUser || !workflowId) return;

    try {
      const API_URL = API_BASE_URL;

      // Check backend health first for both activation and deactivation
      try {
        const healthCheck = await fetch(`${API_URL}/health`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (!healthCheck.ok) {
          throw new Error("Backend server is not responding");
        }
      } catch (healthError: any) {
        console.error("Backend health check failed:", healthError);
        toast({
          title: "Error",
          description: `Backend server is not available. Please ensure your backend is running on ${API_BASE_URL}`,
          variant: "destructive",
        });
        return;
      }

      const newStatus = !isActive;

      // Call the correct backend endpoint
      const res = await fetch(
        `${API_URL}/workflows/${authUser.id}/${workflowId}/schedule`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            is_active: newStatus,
          }),
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText);
      }

      // Update database to reflect the change
      const { error } = await supabase
        .from("workflows")
        .update({ is_active: newStatus })
        .eq("id", workflowId);

      if (error) {
        throw error;
      }

      // Update local state
      setIsActive(newStatus);

      if (!newStatus) {
        nodes
          .filter((node) => {
            const nodeName = (node.data?.definition as any)?.name;
            return nodeName === "AlpacaNews";
          })
          .forEach((node) => {
            const nodeData = node.data as any;
            const candidateSymbols =
              executionStore.getNodeData(node.id)?.output?.symbols ??
              nodeData?.output?.symbols ??
              nodeData?.values?.symbols ??
              nodeData?.fieldState?.symbols;
            cleanupAlpacaSubscription(
              node.id,
              parseSymbolsValue(candidateSymbols)
            );
          });
      }

      toast({
        title: "Success",
        description: `Workflow ${
          newStatus ? "activated" : "deactivated"
        } successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: `Failed to ${
          !isActive ? "activate" : "deactivate"
        } workflow: ${error.message}`,
        variant: "destructive",
      });
    }
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    mousePosRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  // Function to create a new node
  const createNode = useCallback(
    (nodeType: string, position: { x: number; y: number }) => {
      const nodeDefinition = nodeManifest[nodeType];

      // Generate human-readable ID by counting existing nodes of same type
      const existingNodesOfType = nodes.filter(
        (node) => node.type === nodeType
      );
      const nodeId =
        existingNodesOfType.length === 0
          ? nodeType
          : `${nodeType}${existingNodesOfType.length}`;

      const newNode: Node = {
        id: nodeId,
        type: nodeType,
        position,
        data: {
          label: nodeDefinition?.name || `${nodeType} node`,
          definition: nodeDefinition,
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes, nodes]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      // Only create a node when dropping a valid palette item
      if (!type) return;
      if (!(type in nodeManifest)) return;

      // Get the ReactFlow wrapper element to calculate relative position
      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      };

      createNode(type, position);
    },
    [createNode]
  );

  // Handle node click from palette
  const handleNodeClick = useCallback(
    (nodeType: string) => {
      const workflowCanvas = document.querySelector(".workflow-canvas");

      const position = workflowCanvas
        ? (() => {
            const rect = workflowCanvas.getBoundingClientRect();

            return rf.screenToFlowPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            });
          })()
        : { x: 250, y: 250 };

      createNode(nodeType, position);

      // Optionally hide palette after adding node
      setIsPaletteVisible(false);
    },
    [createNode, rf]
  );

  // Check for user authentication and load latest workflow
  const [hasLoadedWorkflowId, setHasLoadedWorkflowId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (authLoading) return; // Wait for auth to finish loading

    if (!authUser) {
      // Redirect to login if no user found
      navigate("/login");
      return;
    }

    // Prevent reloading if we've already loaded this workflow
    if (hasLoadedWorkflowId && workflowId === hasLoadedWorkflowId) {
      //console.log("🚫 Skipping reload - workflow already loaded");
      return;
    }

    const loadWorkflow = async () => {
      // Load workflow - either start fresh for new workflow or load specific existing workflow
      if (isNewWorkflow) {
        // For ALL new workflows, start completely fresh
        // Generate smart workflow name based on existing workflows
        setLoading(true);
        try {
          // Get existing workflow names to determine next number
          const { data: existingWorkflows, error } = await supabase
            .from("workflows")
            .select("name")
            .eq("user_id", authUser.id);

          let workflowName = "My workflow 1";

          if (!error && existingWorkflows) {
            // Find the highest number in existing "My workflow X" names
            const workflowNumbers = existingWorkflows
              .map((w) => w.name)
              .filter((name) => name.startsWith("My workflow "))
              .map((name) => {
                const match = name.match(/My workflow (\d+)/);
                return match ? parseInt(match[1]) : 0;
              })
              .filter((num) => !isNaN(num));

            const maxNumber =
              workflowNumbers.length > 0 ? Math.max(...workflowNumbers) : 0;
            const nextNumber = maxNumber + 1;

            workflowName = projectId
              ? `New Project Workflow ${nextNumber}`
              : `My workflow ${nextNumber}`;
          }

          setWorkflowName(workflowName);
        } catch (error) {
          console.error("Error generating workflow name:", error);
          // Fallback to default names
          setWorkflowName(projectId ? "New Project Workflow" : "My workflow 1");
        }

        setNodes(initialNodes);
        setEdges(initialEdges);
        setIsActive(false);
        setLoading(false);
        setHasLoadedWorkflowId("new");
      } else if (workflowId && workflowId !== hasLoadedWorkflowId) {
        // Load specific existing workflow only if it's different from what we've loaded
        setLoading(true);
        try {
          const { data, error } = await supabase
            .from("workflows")
            .select("*")
            .eq("id", workflowId)
            .eq("user_id", authUser.id)
            .single();

          if (data && !error) {
            setWorkflowName(data.name || "Untitled Workflow");
            setIsActive(!!data.is_active);

            // Load nodes and edges
            if (data.nodes && Array.isArray(data.nodes)) {
              // Restore node definitions from manifest when loading from database
              const restoredNodes = (data.nodes as unknown as Node[]).map(
                (node) => {
                  // Use node.name (new format) or node.id (old format) to look up the definition
                  const nodeName = (node as any).name || node.id;
                  const definition =
                    node.data?.definition ||
                    nodeManifest[nodeName as keyof typeof nodeManifest];

                  return {
                    ...node,
                    // Set React Flow's type to the manifest key for proper rendering
                    type: nodeName,
                    data: {
                      ...node.data,
                      definition,
                      // Ensure values are properly mapped to data.values for BaseNode to use
                      values: (node as any).values || node.data?.values || {},
                      // Restore display name for backward compatibility
                      displayName: node.id,
                    },
                  };
                }
              );
              setNodes(restoredNodes);

              // Clean up invalid edges after nodes are set
              if (data.edges && Array.isArray(data.edges)) {
                const validEdges = (data.edges as unknown as Edge[]).filter(
                  (edge) => {
                    // Check if edge connects to a valid source handle
                    const sourceNode = restoredNodes.find(
                      (n) => n.id === edge.source
                    );
                    if (!sourceNode || !edge.sourceHandle) return true; // Keep non-handle edges

                    // For Switch nodes, validate that the sourceHandle exists in cases
                    const nodeDefinition = sourceNode.data?.definition as any;
                    const nodeType = nodeDefinition?.name;
                    if (nodeType === "Switch") {
                      const cases =
                        sourceNode.data?.values?.cases ||
                        (sourceNode as any).values?.cases ||
                        [];
                      const validHandles = cases.map(
                        (c: any) => c.caseValue || `case${cases.indexOf(c) + 1}`
                      );
                      validHandles.push("default"); // Add default handle

                      if (!validHandles.includes(edge.sourceHandle)) {
                        console.log(
                          `🗑️ Removing invalid edge: ${edge.id} - handle "${edge.sourceHandle}" not found in Switch node`
                        );
                        return false; // Remove invalid edge
                      }
                    }

                    return true; // Keep valid edge
                  }
                );

                setEdges(
                  validEdges.map((e) => ({
                    ...e,
                    type: e.type || "removable",
                    data: {
                      ...(e.data || {}),
                      onRemoveEdge: () => removeEdge(e.id),
                    },
                  }))
                );
              }
            } else if (data.edges && Array.isArray(data.edges)) {
              // If no nodes but edges exist, just set edges directly
              setEdges(
                (data.edges as unknown as Edge[]).map((e) => ({
                  ...e,
                  type: e.type || "removable",
                  data: {
                    ...(e.data || {}),
                    onRemoveEdge: () => removeEdge(e.id),
                  },
                }))
              );
            }
            setHasLoadedWorkflowId(workflowId);
          } else {
            console.error("Workflow not found or access denied");
            navigate("/dashboard/workflows");
          }
        } catch (error) {
          console.error("Error loading workflow:", error);
          navigate("/dashboard/workflows");
        }
        setLoading(false);
      }
    };

    loadWorkflow();
  }, [
    authUser?.id,
    authLoading,
    navigate,
    isNewWorkflow,
    workflowId,
    hasLoadedWorkflowId,
  ]); // Added hasLoadedWorkflowId to prevent unnecessary reloads

  // Auto-hide palette when clicking outside or on editor
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isPaletteVisible) return;

      const target = event.target as Element;
      const palette = document.querySelector(".node-palette-container");
      const toggleButton = document.querySelector(".palette-toggle-button");

      if (
        palette &&
        toggleButton &&
        !palette.contains(target) &&
        !toggleButton.contains(target)
      ) {
        setIsPaletteVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isPaletteVisible]);

  // Handle ReactFlow clicks specifically
  const onPaneClick = useCallback(() => {
    if (isPaletteVisible) {
      setIsPaletteVisible(false);
    }
  }, [isPaletteVisible]);

  // Handle delete key to remove selected nodes
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable;

      if (isEditable) {
        return;
      }

      const isModKey = event.metaKey || event.ctrlKey;

      if (isModKey && event.key.toLowerCase() === "z") {
        const previousState = historyRef.current.pop();
        if (!previousState) {
          return;
        }

        setNodes(cloneNodes(previousState.nodes));
        setEdges(cloneEdges(previousState.edges));
        toast({ description: "Undid last change" });
        return;
      }

      if (isModKey && event.key.toLowerCase() === "c") {
        const selectedNodes = nodes.filter((node) => node.selected);
        if (selectedNodes.length === 0) {
          return;
        }

        const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
        const selectedEdges = edges.filter(
          (edge) =>
            selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
        );

        const nodesCopy = selectedNodes.map((node) => ({
          ...node,
          data: { ...node.data },
        }));

        const edgesCopy = selectedEdges.map((edge) => ({
          ...edge,
          data: { ...edge.data },
        }));

        clipboardRef.current = { nodes: nodesCopy, edges: edgesCopy };
        toast({ description: "Selection copied" });
        return;
      }

      // Cut (Ctrl+X) - Copy to clipboard then delete
      if (isModKey && event.key.toLowerCase() === "x") {
        const selectedNodes = nodes.filter((node) => node.selected);
        if (selectedNodes.length === 0) {
          return;
        }

        // 1. Copy selected nodes to clipboard (same as Ctrl+C)
        const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
        const selectedEdges = edges.filter(
          (edge) =>
            selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
        );

        const nodesCopy = selectedNodes.map((node) => ({
          ...node,
          data: { ...node.data },
        }));

        const edgesCopy = selectedEdges.map((edge) => ({
          ...edge,
          data: { ...edge.data },
        }));

        clipboardRef.current = { nodes: nodesCopy, edges: edgesCopy };

        // 2. Delete selected nodes from canvas (same as Delete key)
        const selectedNodeIdArray = Array.from(selectedNodeIds);

        saveHistorySnapshot();

        setNodes((nds) => nds.filter((node) => !node.selected));

        setEdges((eds) =>
          eds.filter(
            (edge) =>
              !edge.selected &&
              !selectedNodeIdArray.includes(edge.source) &&
              !selectedNodeIdArray.includes(edge.target)
          )
        );

        toast({ description: "Selection cut" });
        return;
      }

      if (isModKey && event.key.toLowerCase() === "v") {
        if (!clipboardRef.current) {
          return;
        }

        const { nodes: copiedNodes, edges: copiedEdges } = clipboardRef.current;
        if (copiedNodes.length === 0) {
          return;
        }

        saveHistorySnapshot();

        const flowPosition = rf.screenToFlowPosition({
          x: mousePosRef.current.x,
          y: mousePosRef.current.y,
        });

        const minX = Math.min(
          ...copiedNodes.map((node) => node.position?.x ?? 0)
        );
        const minY = Math.min(
          ...copiedNodes.map((node) => node.position?.y ?? 0)
        );
        const nodeIdMap: Record<string, string> = {};
        const timestamp = Date.now();
        const existingNodeIds = new Set(nodes.map((node) => node.id));
        const existingEdgeIds = new Set(edges.map((edge) => edge.id));
        const existingDisplayNames = new Set(
          nodes.map((n) => n.data?.displayName || n.id)
        );

        const newNodes = copiedNodes.map((node) => {
          const nodeType = node.type || "default";

          const existingOfType = nodes.filter(
            (n) => n.type === nodeType
          ).length;
          const alreadyAddedOfType = Object.values(nodeIdMap).filter(
            (id) => id === nodeType || id.startsWith(nodeType)
          ).length;

          let count = existingOfType + alreadyAddedOfType;
          let newId = count === 0 ? nodeType : `${nodeType}${count}`;

          while (existingNodeIds.has(newId)) {
            count += 1;
            newId = `${nodeType}${count}`;
          }

          existingNodeIds.add(newId);
          nodeIdMap[node.id] = newId;

          // Generate unique display name
          const originalDisplayName = (node.data?.displayName ||
            newId) as string;
          let uniqueDisplayName = originalDisplayName;

          if (existingDisplayNames.has(uniqueDisplayName)) {
            const baseMatch = originalDisplayName.match(/^(.+?)\s*\d*$/);
            const baseName = baseMatch
              ? baseMatch[1].trim()
              : originalDisplayName;

            let displayCount = 1;
            uniqueDisplayName = `${baseName} ${displayCount}`;

            while (existingDisplayNames.has(uniqueDisplayName)) {
              displayCount++;
              uniqueDisplayName = `${baseName} ${displayCount}`;
            }
          }

          existingDisplayNames.add(uniqueDisplayName);

          return {
            ...node,
            id: newId,
            position: {
              x: flowPosition.x + ((node.position?.x ?? 0) - minX),
              y: flowPosition.y + ((node.position?.y ?? 0) - minY),
            },
            selected: true,
            data: {
              ...node.data,
              displayName: uniqueDisplayName,
              isExecuting: false,
            },
          };
        });

        const newEdges = copiedEdges
          .map((edge, index) => {
            const newSource = nodeIdMap[edge.source];
            const newTarget = nodeIdMap[edge.target];

            if (!newSource || !newTarget) {
              return null;
            }

            let newId = `edge_${timestamp}_${index}`;
            while (existingEdgeIds.has(newId)) {
              newId = `edge_${timestamp}_${index}_${Math.random()
                .toString(36)
                .slice(2, 6)}`;
            }
            existingEdgeIds.add(newId);

            return {
              ...edge,
              id: newId,
              source: newSource,
              target: newTarget,
              selected: true,
              data: {
                ...edge.data,
                onRemoveEdge: () => removeEdge(newId),
              },
            } as Edge;
          })
          .filter((edge): edge is Edge => Boolean(edge));

        setNodes((nds) => {
          const deselected = nds.map((node) => ({ ...node, selected: false }));
          return [...deselected, ...newNodes];
        });

        setEdges((eds) => [...eds, ...newEdges]);

        toast({ description: "Selection pasted" });
        return;
      }

      if (event.key === "Delete") {
        //console.log("Delete key pressed - removing selected nodes");

        // Get IDs of nodes being deleted
        const selectedNodeIds = nodes
          .filter((node) => node.selected)
          .map((node) => node.id);

        if (selectedNodeIds.length === 0) {
          return;
        }

        saveHistorySnapshot();

        // Remove selected nodes
        setNodes((nds) => nds.filter((node) => !node.selected));

        // Remove selected edges AND edges connected to deleted nodes
        setEdges((eds) =>
          eds.filter(
            (edge) =>
              !edge.selected &&
              !selectedNodeIds.includes(edge.source) &&
              !selectedNodeIds.includes(edge.target)
          )
        );
      }
      if (event.key === "Backspace") {
        //console.log("Backspace key pressed but should NOT delete nodes");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    setNodes,
    setEdges,
    nodes,
    edges,
    toast,
    removeEdge,
    cloneEdges,
    cloneNodes,
    saveHistorySnapshot,
  ]);

  // Add visibility change handler to prevent state loss on tab switching
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Auto-save when tab becomes hidden to preserve unsaved changes
        if (nodes.length > 0 && authUser) {
          console.log("🔄 Tab hidden - preserving workflow state");
          handleSaveWorkflow(); // Autosave
        }
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Warn user if they have unsaved changes in a new workflow
      if (isNewWorkflow && nodes.length > 1) {
        // More than just initial node
        e.preventDefault();
        e.returnValue = "";
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [nodes, authUser?.id, isNewWorkflow, handleSaveWorkflow]);

  return (
    <div className="flex flex-col h-[calc(100vh)] w-full">
      {/* Workflow Header - Fixed at top */}
      <div className="flex items-center justify-between px-6 pl-16 py-2 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-1">
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="text-xl font-bold bg-transparent border-none p-0 h-auto focus-visible:ring-0 hover:bg-muted/30 rounded px-2 py-1 transition-colors"
              placeholder="Workflow name"
            />
          </div>
          
          {/* Editor/Executions Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "editor" | "executions")}>
            <TabsList className="h-8">
              <TabsTrigger value="editor" className="text-xs px-3 h-7">Editor</TabsTrigger>
              <TabsTrigger value="executions" className="text-xs px-3 h-7">
                Executions
                {executions.length > 0 && (
                  <span className="ml-1.5 bg-muted px-1.5 py-0.5 rounded text-[10px]">
                    {executions.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => handleSaveWorkflow()}
            disabled={loading}
            variant="outline"
            className="h-10 px-4 font-medium hover:bg-muted/50 transition-colors"
          >
            <Save className="h-4 w-4 mr-2" />
            {loading ? "Saving..." : "Save"}
          </Button>

          <Button
            onClick={executeAllNodes}
            disabled={loading || isAutoExecuting || nodes.length === 0}
            variant="secondary"
            className="h-10 px-4 font-medium bg-primary/10 hover:bg-primary/20 text-primary border-primary/20 transition-all duration-200"
          >
            {isAutoExecuting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Execute All
              </>
            )}
          </Button>

          <Button
            onClick={handleActivate}
            disabled={loading}
            className="h-10 px-6 font-medium bg-success hover:bg-success/90 text-success-foreground shadow-sm transition-all duration-200"
          >
            <Play className="h-4 w-4 mr-2" />
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "editor" ? (
        // Editor View
        <div className="flex flex-1 overflow-hidden">
          {/* ReactFlow Canvas */}
          <div className="flex-1 bg-trading-grid">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onMouseMove={onMouseMove}
              onNodeDoubleClick={onNodeDoubleClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionLineComponent={EdgeManager.PlugConnectionLine}
              connectionLineType={ConnectionLineType.Bezier}
              fitView
              className={cn(
                "workflow-canvas",
                resolvedTheme === "dark" && "dark"
              )}
              style={{ backgroundColor: "hsl(var(--trading-grid))" }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={0.8}
                color="hsl(var(--muted-foreground) / 0.60)"
              />
              <MiniMap
                className="!bg-card !border-border"
                maskColor="hsl(var(--muted) / 0.6)"
              />
              <Controls className="!bg-card !border-border [&>button]:!bg-transparent [&>button]:!border-border hover:[&>button]:!bg-muted" />
            </ReactFlow>
          </div>

          {/* Right Sidebar - Node Palette */}
          {isPaletteVisible && (
            <div className="w-80 border-l border-border bg-sidebar node-palette-container flex-shrink-0">
              <NodePalette onNodeClick={handleNodeClick} />
            </div>
          )}
        </div>
      ) : (
        // Executions View
        <div className="flex flex-1 overflow-hidden">
          <ExecutionHistoryPanel
            workflowId={workflowId}
            selectedExecution={selectedExecution}
            onSelectExecution={setSelectedExecution}
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
            onRefresh={refreshExecutions}
            executions={executions}
            loading={executionsLoading}
            getDuration={getDuration}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
          
          {selectedExecution ? (
            <ExecutionDetailView
              execution={selectedExecution}
              nodes={nodes}
              edges={edges}
              nodeExecutions={getNodeExecutions(selectedExecution)}
              onCopyToEditor={() => setActiveTab("editor")}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground bg-trading-grid">
              <div className="text-center">
                <p className="text-lg">Select an execution to view details</p>
                <p className="text-sm mt-1">Click on any execution from the list on the left</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toggle Arrow - positioned relative to main content area (only in editor mode) */}
      {activeTab === "editor" && (
        <button
          onClick={() => setIsPaletteVisible(!isPaletteVisible)}
          className={`fixed top-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-l-lg p-2 shadow-lg hover:bg-muted transition-all duration-200 palette-toggle-button ${
            isPaletteVisible ? "right-80" : "right-0"
          }`}
        >
          {isPaletteVisible ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      )}
    </div>
  );
};

const WorkflowEditor = () => (
  <ReactFlowProvider>
    <ExecutionStoreProvider>
      <WorkflowEditorContent />
    </ExecutionStoreProvider>
  </ReactFlowProvider>
);

export default WorkflowEditor;
