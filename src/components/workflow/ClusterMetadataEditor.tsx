import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { NodeCluster } from "@/domain/clusters/types";

export interface ClusterMetadataEditIntent {
  workflowSessionId: string;
  clusterId: string;
  title: string;
  note?: string;
}

interface Props {
  cluster: NodeCluster;
  workflowSessionId: string;
  editingTitle: boolean;
  disabled: boolean;
  onEditTitle: () => void;
  onFinishTitle: () => void;
  onCommit: (patch: Partial<Pick<NodeCluster, "title" | "note">>, intent: ClusterMetadataEditIntent) => boolean;
}

/** Draft typing stays local; blur/Enter commits once and Escape cancels. */
export function ClusterMetadataEditor({ cluster, workflowSessionId, editingTitle, disabled, onEditTitle, onFinishTitle, onCommit }: Props) {
  const [title, setTitle] = useState(cluster.title);
  const [note, setNote] = useState(cluster.note ?? "");
  const intent = useRef<ClusterMetadataEditIntent>({workflowSessionId, clusterId:cluster.id, title:cluster.title, note:cluster.note});
  const cancelled = useRef(false);
  useEffect(() => {
    setTitle(cluster.title);
    setNote(cluster.note ?? "");
  }, [cluster.id, cluster.title, cluster.note, workflowSessionId]);
  const begin = () => {
    cancelled.current = false;
    intent.current = {workflowSessionId, clusterId:cluster.id, title:cluster.title, note:cluster.note};
  };
  const finish = (field: "title" | "note") => {
    if (!cancelled.current && !disabled) {
      const value = field === "title" ? title : note;
      onCommit({[field]: field === "note" ? value || undefined : value}, intent.current);
    }
    cancelled.current = false;
    if (field === "title") {setTitle(cluster.title); onFinishTitle();}
    else setNote(cluster.note ?? "");
  };
  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>, field: "title" | "note") => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelled.current = event.key === "Escape";
    event.currentTarget.blur();
    if (field === "title" && cancelled.current) onFinishTitle();
  };
  return <>
    {editingTitle ? <Input
      autoFocus aria-label={`${cluster.title} title`} className="h-7 min-w-0 flex-1"
      value={title} disabled={disabled} onFocus={begin}
      onChange={event => setTitle(event.target.value)} onBlur={() => finish("title")}
      onKeyDown={event => keyDown(event, "title")}
      onPointerDown={event => event.stopPropagation()}
    /> : <button
      disabled={disabled} className="nodrag min-w-0 flex-1 truncate text-left text-sm font-semibold"
      onPointerDown={event => event.stopPropagation()} onDoubleClick={onEditTitle}
    >{cluster.title}</button>}
    <Input
      aria-label={`${cluster.title} note`} className="h-7 w-36" maxLength={200}
      placeholder="Add note" value={note} disabled={disabled} onFocus={begin}
      onChange={event => setNote(event.target.value)} onBlur={() => finish("note")}
      onKeyDown={event => keyDown(event, "note")}
      onPointerDown={event => event.stopPropagation()}
    />
  </>;
}
