/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Node,
  Edge,
  type NodeProps,
} from "@xyflow/react";
import { format } from "date-fns";
import { CheckCircle2, XCircle, Copy, Clock, Loader2, ChevronUp } from "lucide-react";
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
import { CompactClusterNode } from "./CompactClusterNode";
import { parseNodeClusters } from "@/domain/clusters/parse";
import { resolveClusterHierarchy } from "@/domain/clusters/hierarchy";
import { focusedClusterToViewState } from "@/domain/clusters/viewState";
import { reconcileClusterProjection } from "@/domain/clusters/reconcileProjection";
import {
  getExpandedClusterFrameRect,
  getVisibleClusterNodes,
  projectClusterGraph,
  type ClusterProjection,
  type CompactClusterFlowNode,
} from "@/domain/clusters/projection";

const HistoryClusterNode = (props: NodeProps<CompactClusterFlowNode>) => (
  <CompactClusterNode {...props} readOnly />
);

// Create execution-specific node types using NodeRouter for all node types
const executionNodeTypes = Object.fromEntries([
  ...Object.keys(nodeManifest).map((key) => [key, NodeRouter]),
  ...Object.values(nodeManifest).map((def: any) => [def.name, NodeRouter]),
  ["compactCluster", HistoryClusterNode],
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
  const [clusterFocus, setClusterFocus] = useState<{ executionId: string; clusterId: string | null } | null>(null);
  const focusedClusterId = clusterFocus?.executionId === execution.id ? clusterFocus.clusterId : null;
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const openCluster = useCallback((clusterId: string | null) => {
    setClusterFocus({ executionId: execution.id, clusterId });
  }, [execution.id]);
  const clusters = useMemo(() => Array.isArray(execution.nodes)
    ? parseNodeClusters(execution.node_clusters).clusters : [], [execution.nodes, execution.node_clusters]);
  const clusterViewState = useMemo(
    () => focusedClusterToViewState(focusedClusterId, clusters),
    [focusedClusterId, clusters],
  );

  // Depend on the chosen snapshot, so live editor changes do not re-clone history.
  const snapshotNodes = Array.isArray(execution.nodes) ? execution.nodes : nodes;
  const snapshotEdges = Array.isArray(execution.edges) ? execution.edges : edges;
  const sourceNodes = useMemo(
    () => JSON.parse(JSON.stringify(snapshotNodes)) as Node[],
    [snapshotNodes],
  );
  const sourceEdges = useMemo(
    () => JSON.parse(JSON.stringify(snapshotEdges)) as Edge[],
    [snapshotEdges],
  );

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
          displayName: (node as any).displayName || node.data?.displayName || node.id,
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
          historyEdges: sourceEdges,
          // Display name from execution or original
          label: node.data?.displayName || (node.data?.definition as any)?.name,
        },
      };
    });
  }, [hydratedNodes, nodeExecutionMap, nodeExecutions, sourceEdges]);

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

  const hierarchy = useMemo(() => resolveClusterHierarchy(clusters), [clusters]);
  const committedProjection = useRef<{ executionId: string; projection: ClusterProjection } | null>(null);
  const clusterProjection = useMemo(() => reconcileClusterProjection(
    committedProjection.current?.executionId === execution.id ? committedProjection.current.projection : null,
    projectClusterGraph(executionNodes, executionEdges, clusters, clusterViewState, openCluster, {
      focusedClusterId,
      zoom: viewport.zoom,
      draggable: false,
    }),
  ), [execution.id, executionNodes, executionEdges, clusters, clusterViewState, openCluster, focusedClusterId, viewport.zoom]);
  useLayoutEffect(() => {
    committedProjection.current = { executionId: execution.id, projection: clusterProjection };
  }, [execution.id, clusterProjection]);
  const fitViewOptions = useMemo(() => ({
    padding: 0.2, maxZoom: 1, minZoom: 0.4,
    nodes: getVisibleClusterNodes(clusterProjection),
  }), [clusterProjection]);

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
                nodeExecutions={nodeExecutions}
              >
                <ReactFlow
                  colorMode={resolvedTheme}
                  nodes={clusterProjection.nodes}
                  edges={clusterProjection.edges}
                  nodeTypes={executionNodeTypes}
                  edgeTypes={executionEdgeTypes}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  deleteKeyCode={null}
                  elementsSelectable={true}
                  zoomOnDoubleClick={false}
                  fitView
                  fitViewOptions={fitViewOptions}
                  onMove={(_, nextViewport) => setViewport(nextViewport)}
                  className={cn(
                    "workflow-canvas execution-canvas",
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
                    bgColor="hsl(var(--card))"
                    nodeColor={(node) => clusterProjection.hiddenRuntimeHostIds.has(node.id) ? "transparent" : "hsl(var(--node-neon-color, var(--primary)))"}
                    nodeStrokeColor={(node) => clusterProjection.hiddenRuntimeHostIds.has(node.id) ? "transparent" : "hsl(var(--border))"}
                    nodeClassName={(node) => clusterProjection.hiddenRuntimeHostIds.has(node.id) ? "hidden" : ""}
                    maskColor="hsl(var(--background) / 0.6)"
                  />
                  <Controls fitViewOptions={fitViewOptions} className="!bg-card !border-border [&>button]:!bg-transparent [&>button]:!border-border hover:[&>button]:!bg-muted" />
                </ReactFlow>
              </StaticExecutionStoreProvider>
            </StableNodeProvider>
          </ReactFlowProvider>
          <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" aria-label="Execution clusters">
            {clusters.filter((cluster) => clusterViewState[cluster.id])
              .sort((a, b) => (hierarchy.ancestors.get(a.id)?.length ?? 0) - (hierarchy.ancestors.get(b.id)?.length ?? 0))
              .map((cluster) => {
                const rect = getExpandedClusterFrameRect(cluster, executionNodes, clusters, clusterViewState, viewport.zoom);
                if (!rect) return null;
                return (
                  <section key={cluster.id} id={`cluster-frame-${cluster.id}`} className="cluster-frame absolute rounded-xl border-2"
                    style={{ transform: `translate(${rect.x * viewport.zoom + viewport.x}px, ${rect.y * viewport.zoom + viewport.y}px) scale(${viewport.zoom})`, transformOrigin: "top left", width: rect.width, height: rect.height }}>
                    <header className="cluster-frame__header pointer-events-auto flex min-h-10 items-center gap-2 rounded-t-lg px-3 py-1 text-[hsl(var(--cluster-title))]">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={cluster.note}>{cluster.title}</span>
                      <span className="text-xs text-muted-foreground">{hierarchy.effectiveMembers.get(cluster.id)?.length ?? 0} nodes</span>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                        aria-label={`Collapse cluster ${cluster.title}`} aria-expanded={true}
                        aria-controls={`cluster-frame-${cluster.id}`} onClick={() => openCluster(cluster.parentClusterId ?? null)}>
                        <ChevronUp aria-hidden="true" />
                      </Button>
                    </header>
                  </section>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
