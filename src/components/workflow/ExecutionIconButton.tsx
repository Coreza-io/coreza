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
import "./MechanicalNodeControl.css";

export type ExecutionPhase =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "cancelled"
  | "failed"
  | "blocked";

export interface ExecutionControlProps {
  targetKind: "node" | "cluster";
  targetName: string;
  phase: ExecutionPhase;
  disabledReason?: string;
  statusDescription?: string;
  onExecute: () => void;
  onStop?: () => void;
  className?: string;
  presentation?: "icon" | "labelled";
}

const isolatePointer = (event: PointerEvent<HTMLElement>): void => event.stopPropagation();
const isolateMouse = (event: MouseEvent<HTMLElement>): void => event.stopPropagation();

export function ExecutionControl({
  targetKind,
  targetName,
  phase,
  disabledReason,
  statusDescription,
  onExecute,
  onStop,
  className,
  presentation = "icon",
}: ExecutionControlProps): JSX.Element {
  const lastActivation = useRef(Number.NEGATIVE_INFINITY);
  const busy = phase === "running" || phase === "stopping";
  const canStop = phase === "running" && Boolean(onStop);
  const blocked = phase === "blocked" || (busy && !canStop);
  const verb = canStop ? "Stop" : "Execute";
  const label = `${verb} ${targetKind} ${targetName}`;
  const description = disabledReason ?? statusDescription ?? label;
  const buttonText = canStop ? "Stop" : phase === "stopping" ? "Stopping…" : busy ? "Executing…" : "Execute";
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


  // Expanded node panels use the compact Mechanical Control · V2 skin.
  // Keep the existing execution handler, state and guard logic unchanged.
  if (targetKind === "node" && presentation === "labelled") {
    return (
      <>
        <div className={cn("flex w-full justify-center py-1", className)}>
              <button
                type="button"
                className={cn(
                  "nodrag nopan mechanical-node-execute",
                  canStop && "mechanical-node-execute--running",
                  phase === "failed" && "mechanical-node-execute--failed",
                  blocked && "mechanical-node-execute--blocked",
                )}
                aria-label={label}
                aria-busy={busy || undefined}
                aria-disabled={blocked || undefined}
                onPointerDown={isolatePointer}
                onClick={(event) => { isolateMouse(event); activate(); }}
                onDoubleClick={isolateMouse}
                onKeyDown={onKeyDown}
              >
                <span className="mechanical-node-execute__well">
                  <span className="mechanical-node-execute__face">
                    {canStop ? (
                      <Square className="mechanical-node-execute__icon" fill="currentColor" aria-hidden="true" />
                    ) : busy ? (
                      <LoaderCircle className="mechanical-node-execute__icon animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <svg className="mechanical-node-execute__icon" viewBox="0 0 72 72" aria-hidden="true">
                        <path d="M20 12 Q20 8 25 11 L60 32 Q65 36 60 40 L25 61 Q20 64 20 59 Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                </span>
              </button>
        </div>
        <span className="sr-only" aria-live="polite">{statusDescription}</span>
      </>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size={presentation === "icon" ? "icon" : undefined}
            variant={presentation === "icon" ? "secondary" : "nodeExecute"}
            className={cn(
              "nodrag nopan",
              presentation === "icon" ? "h-9 w-9 shrink-0" : "w-full",
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
            {presentation === "labelled" ? (
              <>
                {busy && !canStop && <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                {buttonText}
              </>
            ) : canStop ? (
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

export function ExecutionIconButton(
  props: Omit<ExecutionControlProps, "presentation">,
): JSX.Element {
  return <ExecutionControl {...props} presentation="icon" />;
}
