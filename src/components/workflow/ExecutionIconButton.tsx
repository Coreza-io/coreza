import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { LoaderCircle, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ExecutionPhase =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "cancelled"
  | "failed"
  | "blocked";

interface ExecutionIconButtonProps {
  targetKind: "node" | "cluster";
  targetName: string;
  phase: ExecutionPhase;
  disabledReason?: string;
  statusDescription?: string;
  onExecute: () => void;
  onStop?: () => void;
  className?: string;
}

const isolatePointer = (event: PointerEvent<HTMLElement>): void => event.stopPropagation();
const isolateMouse = (event: MouseEvent<HTMLElement>): void => event.stopPropagation();

export function ExecutionIconButton({
  targetKind,
  targetName,
  phase,
  disabledReason,
  statusDescription,
  onExecute,
  onStop,
  className,
}: ExecutionIconButtonProps): JSX.Element {
  const lastActivation = useRef(Number.NEGATIVE_INFINITY);
  const busy = phase === "running" || phase === "stopping";
  const canStop = phase === "running" && Boolean(onStop);
  const blocked = phase === "blocked" || (busy && !canStop);
  const verb = canStop ? "Stop" : "Execute";
  const label = `${verb} ${targetKind} ${targetName}`;
  const description = disabledReason ?? statusDescription ?? label;
  const activate = (): void => {
    if (blocked) return;
    const now = performance.now();
    if (now - lastActivation.current < 250) return;
    lastActivation.current = now;
    if (canStop) onStop?.();
    else onExecute();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={cn(
              "nodrag nopan h-9 w-9 shrink-0",
              phase === "failed" && "text-destructive",
              className,
            )}
            aria-label={label}
            aria-busy={busy || undefined}
            aria-disabled={blocked || undefined}
            onPointerDown={isolatePointer}
            onClick={(event) => { isolateMouse(event); activate(); }}
            onDoubleClick={isolateMouse}
            onKeyDown={onKeyDown}
          >
            {canStop ? (
              <Square className="h-4 w-4" aria-hidden="true" />
            ) : busy ? (
              <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">{statusDescription}</span>
    </TooltipProvider>
  );
}
