/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Node,
  Edge,
} from "@xyflow/react";
import { format } from "date-fns";
import { CheckCircle2, XCircle, Copy, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ExecutionRun, NodeExecutionLog } from "@/hooks/useExecutionHistory";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import NodeRouter from "@/components/nodes/NodeRouter";
import EdgeManager from "./EdgeManager";
import { nodeManifest } from "@/nodes/manifest";
import { StaticExecutionStoreProvider } from "@/contexts/StaticExecutionStoreContext";
import { StableNodeProvider } from "@/contexts/StableNodeContext";

// Create execution-specific node types using NodeRouter for all node types
const executionNodeTypes = Object.fromEntries([
  ...Object.keys(nodeManifest).map((key) => [key, NodeRouter]),
  ...Object.values(nodeManifest).map((def: any) => [def.name, NodeRouter]),
]);

// Edge types for execution view
const executionEdgeTypes = {
  default: EdgeManager.PlugEdge,
  loop: EdgeManager.LoopEdge,
  removable: EdgeManager.DefaultEdge,
};

interface ExecutionDetailViewProps {
  execution: ExecutionRun;
  nodes: Node[];
  edges: Edge[];
  nodeExecutions: NodeExecutionLog[];
  onCopyToEditor?: () => void;
  loading?: boolean;
}

export function ExecutionDetailView({
  execution,
  nodes,
  edges,
  nodeExecutions,
  onCopyToEditor,
  loading = false,
}: ExecutionDetailViewProps) {
  const resolvedTheme = useResolvedTheme();

  // Use execution's stored snapshot if available, otherwise fall back to current workflow
  // This ensures historical executions display the workflow state at execution time
  // Deep clone nodes to prevent mutation of original editor nodes
  const sourceNodes = useMemo(() => {
    const hasExecutionNodes =
      execution.nodes &&
      Array.isArray(execution.nodes) &&
      execution.nodes.length > 0;
    if (hasExecutionNodes) {
      return JSON.parse(JSON.stringify(execution.nodes)) as Node[];
    }
    return JSON.parse(JSON.stringify(nodes)) as Node[];
  }, [execution.nodes, nodes]);

  // Deep clone edges to prevent mutation
  const sourceEdges = useMemo(() => {
    if (
      execution.edges &&
      Array.isArray(execution.edges) &&
      execution.edges.length > 0
    ) {
      return JSON.parse(JSON.stringify(execution.edges)) as Edge[];
    }
    return JSON.parse(JSON.stringify(edges)) as Edge[];
  }, [execution.edges, edges]);

  // Get node execution data by nodeId
  const nodeExecutionMap = useMemo(() => {
    const map = new Map<string, NodeExecutionLog>();
    nodeExecutions.forEach((exec) => {
      map.set(exec.nodeId, exec);
    });
    return map;
  }, [nodeExecutions]);

  // Ensure execution nodes always include definitions and consistent types
  const hydratedNodes = useMemo(() => {
    return sourceNodes.map((node) => {
      const nodeType =
        node.type ||
        (node as any).name ||
        (node.data as any)?.definition?.name ||
        node.id;

      const definition =
        (node.data as any)?.definition ||
        nodeManifest[nodeType as keyof typeof nodeManifest];

      return {
        ...node,
        type: nodeType,
        data: {
          ...node.data,
          definition,
          values: (node as any).values || node.data?.values || {},
          displayName: node.id,
        },
      };
    });
  }, [sourceNodes]);

  // Transform nodes to show execution status with readOnly mode
  const executionNodes = useMemo(() => {
    return hydratedNodes.map((node) => {
      const nodeExec = nodeExecutionMap.get(node.id);
      const status = nodeExec?.status || "pending";

      return {
        ...node,
        data: {
          ...node.data,
          // Enable read-only mode for execution view
          readOnly: true,
          // Pass execution-specific data
          executionStatus: status,
          executionDuration: nodeExec?.durationMs,
          itemCount: nodeExec?.itemCount || 0,
          hasError: !!nodeExec?.error,
          errorMessage: nodeExec?.error,
          // Use execution output for output panel
          output: nodeExec?.output,
          // Use execution input for input panel
          executionInput: nodeExec?.input,
          // Pass all node executions for dropdown in input panel
          allNodeExecutions: nodeExecutions,
          // Display name from execution or original
          label: node.data?.displayName || (node.data?.definition as any)?.name,
        },
      };
    });
  }, [hydratedNodes, nodeExecutionMap, nodeExecutions]);

  // Transform edges to show item counts
  const executionEdges = useMemo(() => {
    return sourceEdges.map((edge) => {
      const sourceExec = nodeExecutionMap.get(edge.source);
      const itemCount = sourceExec?.itemCount || 0;

      return {
        ...edge,
        type: edge.type || "default",
        label:
          itemCount > 0
            ? `${itemCount} item${itemCount !== 1 ? "s" : ""}`
            : undefined,
        labelStyle: {
          fill: "hsl(var(--muted-foreground))",
          fontSize: 10,
          fontWeight: 500,
        },
        labelBgStyle: {
          fill: "hsl(var(--card))",
          fillOpacity: 0.9,
        },
        style: {
          ...edge.style,
          stroke:
            sourceExec?.status === "success"
              ? "hsl(var(--success))"
              : sourceExec?.status === "failed"
                ? "hsl(var(--destructive))"
                : "hsl(var(--border))",
          strokeWidth: 2,
        },
        animated: false,
      };
    });
  }, [sourceEdges, nodeExecutionMap]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "running":
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getDurationDisplay = () => {
    if (!execution.completed_at || !execution.started_at) return "—";
    const start = new Date(execution.started_at).getTime();
    const end = new Date(execution.completed_at).getTime();
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      {/* Execution Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50">
        <div className="flex items-center gap-4">
          {getStatusIcon(execution.status)}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">
                {execution.status === "success"
                  ? "Succeeded"
                  : execution.status === "failed"
                    ? "Failed"
                    : execution.status}
              </span>
              <span className="text-muted-foreground text-sm">
                in {getDurationDisplay()}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {format(
                new Date(execution.started_at),
                "MMM d, yyyy 'at' HH:mm:ss",
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            ID: {execution.id.slice(0, 8)}
          </Badge>
          {onCopyToEditor && (
            <Button variant="outline" size="sm" onClick={onCopyToEditor}>
              <Copy className="h-3 w-3 mr-1" />
              Copy to Editor
            </Button>
          )}
        </div>
      </div>

      {/* Error Message */}
      {execution.error_message && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-sm text-destructive">{execution.error_message}</p>
        </div>
      )}

      {/* Main Content - Wrapped in isolated execution store */}
      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 bg-trading-grid relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Loading execution...
                </span>
              </div>
            </div>
          )}

          {!loading && nodeExecutions.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-card/80 text-muted-foreground text-sm px-4 py-2 rounded-md border border-border">
                No node execution details available for this run.
              </div>
            </div>
          )}

          {/* Isolated React Flow context + execution store for historical view */}
          {/* Key by execution.id to force remount when switching runs - ensures field state reinitializes */}
          <ReactFlowProvider key={execution.id}>
            <StableNodeProvider>
              <StaticExecutionStoreProvider
                nodeExecutions={nodeExecutions.map((exec) => ({
                  nodeId: exec.nodeId,
                  output: exec.output,
                  input: exec.input,
                  status: exec.status,
                }))}
              >
                <ReactFlow
                  nodes={executionNodes}
                  edges={executionEdges}
                  nodeTypes={executionNodeTypes}
                  edgeTypes={executionEdgeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={true}
                  zoomOnDoubleClick={false}
                  fitView
                  fitViewOptions={{ padding: 0.2, maxZoom: 1, minZoom: 0.4 }}
                  className={cn(
                    "execution-canvas",
                    resolvedTheme === "dark" && "dark",
                    loading && "opacity-50 pointer-events-none",
                  )}
                  style={{ backgroundColor: "hsl(var(--trading-grid))" }}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={16}
                    size={0.8}
                    color="hsl(var(--muted-foreground) / 0.40)"
                  />
                  <MiniMap
                    className="!bg-card !border-border"
                    maskColor="hsl(var(--muted) / 0.6)"
                  />
                  <Controls className="!bg-card !border-border [&>button]:!bg-transparent [&>button]:!border-border hover:[&>button]:!bg-muted" />
                </ReactFlow>
              </StaticExecutionStoreProvider>
            </StableNodeProvider>
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
}
