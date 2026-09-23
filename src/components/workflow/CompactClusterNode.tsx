import { useEffect } from "react";
import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { ChevronDown, CircleAlert, LoaderCircle, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CompactClusterFlowNode } from "@/domain/clusters/projection";

export function CompactClusterNode({ id, data: cluster }: NodeProps<CompactClusterFlowNode>): JSX.Element {
  const updateNodeInternals = useUpdateNodeInternals();
  const expand = (): void => cluster.onExpand(cluster.clusterId);

  useEffect(() => {
    updateNodeInternals(id);
  }, [cluster.incomingHandleIds, cluster.outgoingHandleIds, id, updateNodeInternals]);

  return (
    <article
      id={`cluster-card-${cluster.clusterId}`}
      className="h-[132px] w-[280px] rounded-xl border-2 border-primary/50 bg-card p-4 shadow-lg motion-safe:transition-shadow"
      onDoubleClick={(event) => { event.stopPropagation(); expand(); }}
    >
      {cluster.incomingHandleIds.map((id, index, handles) => (
        <Handle key={id} id={id} type="target" position={Position.Left} isConnectable={false} style={{ top: 38 + ((index + 1) / (handles.length + 1)) * 76 }} />
      ))}
      {cluster.outgoingHandleIds.map((id, index, handles) => (
        <Handle key={id} id={id} type="source" position={Position.Right} isConnectable={false} style={{ top: 38 + ((index + 1) / (handles.length + 1)) * 76 }} />
      ))}
      <div className="flex items-start gap-3">
        <Network className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{cluster.title}</h3>
          {cluster.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{cluster.note}</p>}
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
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{cluster.memberCount} {cluster.memberCount === 1 ? "node" : "nodes"}</span>
        {cluster.status === "running" && <span className="flex items-center gap-1"><LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />Running</span>}
        {cluster.status === "error" && <span className="flex items-center gap-1 text-destructive"><CircleAlert className="h-3.5 w-3.5" />Error</span>}
      </div>
    </article>
  );
}
