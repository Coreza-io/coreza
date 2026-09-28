import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { CircleAlert, LoaderCircle, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClusterRunState } from "@/hooks/useClusterExecution";

interface Props { title: string; state: ClusterRunState; onExecute: () => void; onCancel: () => void; onRetryOutput?: () => void; className?: string }
const stopPropagation = (event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>) => event.stopPropagation();

export function ClusterExecutionControl({ title, state, onExecute, onCancel, onRetryOutput, className }: Props) {
  const active = state.phase === "queued" || state.phase === "running";
  const pending = state.phase === "preparing" || state.phase === "cancelling";
  const blocked = state.phase === "blocked";
  const label = state.phase === "preparing" ? "Preparing…" : state.phase === "cancelling" ? "Cancelling…"
    : active ? "Stop" : state.phase === "completed" ? "Completed / Run again"
    : state.phase === "cancelled" ? "Cancelled / Run again"
    : state.phase === "failed" ? "Failed / Run again" : blocked ? "Blocked" : "Execute cluster";
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  };
  return <div className={`nodrag nopan flex min-w-0 items-center gap-1 ${className ?? ""}`} onPointerDown={stopPropagation} onDoubleClick={stopPropagation}>
    <Button type="button" size="sm" variant="secondary" className="min-w-0 gap-2" disabled={pending || blocked}
      aria-label={`${active ? "Stop cluster" : "Execute cluster"} ${title}`} title={state.reason}
      onKeyDown={onKeyDown} onClick={(event) => { event.stopPropagation(); if (active) onCancel(); else onExecute(); }}>
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : active ? <Square className="h-4 w-4" aria-hidden="true" />
        : blocked || state.phase === "failed" ? <CircleAlert className="h-4 w-4" aria-hidden="true" />
        : <Play className="h-4 w-4" aria-hidden="true" />}
      <span className="truncate">{label}</span>
    </Button>
    {state.canRetryOutput && onRetryOutput ? <Button type="button" size="sm" variant="outline"
      title={state.outputWarning} onClick={(event) => { event.stopPropagation(); onRetryOutput(); }}>
      Retry output
    </Button> : null}
    <span className="sr-only" aria-live="polite">{state.reason ?? label}</span>
  </div>;
}
