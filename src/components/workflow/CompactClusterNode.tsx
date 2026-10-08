import { useEffect } from "react";
import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { ChevronDown, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CompactClusterFlowNode } from "@/domain/clusters/projection";
import { ClusterExecutionControl } from "./ClusterExecutionControl";
import ElectricBorderSVG from "./ElectricBorderSVG";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";

export function CompactClusterNode({ id, data: cluster, selected, dragging }: NodeProps<CompactClusterFlowNode>): JSX.Element {
  const updateNodeInternals = useUpdateNodeInternals();
  const showExecutionBorder = useResolvedTheme() === "dark"
    && cluster.runState.phase === "running" && !!cluster.runState.currentNodeId;
  const expand = (): void => cluster.onExpand(cluster.clusterId);
  const persistentExecutionStatus = cluster.runState.phase !== "idle"
    && cluster.runState.phase !== "completed"
    && cluster.runState.phase !== "cancelled";

  const handleSignature = `${cluster.incomingHandleIds.join("\u0000")}|${cluster.outgoingHandleIds.join("\u0000")}`;
  useEffect(() => {
    updateNodeInternals(id);
  }, [handleSignature, id, updateNodeInternals]);

  return (
    <article
      id={`cluster-card-${cluster.clusterId}`}
      className={`cluster-card relative group/cluster h-[180px] w-[280px] cursor-grab rounded-xl border-2 p-4 text-[hsl(var(--cluster-title))] shadow-[var(--cluster-shadow)] outline-none motion-safe:transition-[box-shadow,transform] focus-visible:ring-2 focus-visible:ring-[hsl(var(--cluster-selection-ring))] ${selected ? "cluster-card--selected" : ""} ${dragging ? "cursor-grabbing" : ""}`}
      tabIndex={0}
      aria-label={`Cluster ${cluster.title}, ${cluster.memberCount} ${cluster.memberCount === 1 ? "node" : "nodes"}`}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); expand(); } }}
      onDoubleClick={(event) => { event.stopPropagation(); expand(); }}
    >
      {showExecutionBorder && <ElectricBorderSVG isExpanded={false} color="#22d3ee" />}
      {cluster.incomingHandleIds.map((id, index, handles) => (
        <Handle key={id} id={id} type="target" position={Position.Left} isConnectable={false} style={{ top: 38 + ((index + 1) / (handles.length + 1)) * 76 }} />
      ))}
      {cluster.outgoingHandleIds.map((id, index, handles) => (
        <Handle key={id} id={id} type="source" position={Position.Right} isConnectable={false} style={{ top: 38 + ((index + 1) / (handles.length + 1)) * 76 }} />
      ))}
      <div className="flex items-start gap-3">
        <Network className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--cluster-accent))]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{cluster.title}</h3>
          {cluster.note && <p className="mt-1 line-clamp-2 text-xs text-[hsl(var(--cluster-muted))]">{cluster.note}</p>}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="nodrag nopan h-8 w-8 shrink-0"
          title={`Expand ${cluster.title}`}
          aria-label={`Expand cluster ${cluster.title}`}
          aria-expanded={false}
          aria-controls={`cluster-frame-${cluster.clusterId}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); expand(); }}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-[hsl(var(--cluster-muted))]">
        <span>{cluster.memberCount} {cluster.memberCount === 1 ? "node" : "nodes"}</span>
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex h-[52px] items-center justify-center border-t border-[hsl(var(--cluster-border))]">
        <div
          data-cluster-execution-control
          className={`transition-opacity duration-150 motion-reduce:transition-none ${persistentExecutionStatus ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover/cluster:pointer-events-auto group-hover/cluster:opacity-100 group-focus-within/cluster:pointer-events-auto group-focus-within/cluster:opacity-100"}`}
        >
          <ClusterExecutionControl presentation="icon" title={cluster.title} state={cluster.runState}
            onExecute={() => cluster.onExecute(cluster.clusterId)} onCancel={() => cluster.onCancel(cluster.clusterId)} />
        </div>
      </footer>
    </article>
  );
}
