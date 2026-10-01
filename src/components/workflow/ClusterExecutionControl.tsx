import type { ClusterRunState } from "@/hooks/useClusterExecution";
import { ExecutionIconButton, type ExecutionPhase } from "./ExecutionIconButton";

interface Props { title: string; state: ClusterRunState; onExecute: () => void; onCancel: () => void; className?: string }
export function ClusterExecutionControl({ title, state, onExecute, onCancel, className }: Props) {
  const status = state.phase === "running"
    ? `${state.currentNodeId ?? "Running"} · ${state.completed ?? 0}/${state.eligible ?? 0}`
    : state.reason ?? state.phase;
  return <ExecutionIconButton targetKind="cluster" targetName={title}
    phase={state.phase as ExecutionPhase} disabledReason={state.phase === "blocked" ? state.reason : undefined}
    statusDescription={status} onExecute={onExecute} onStop={state.phase === "running" ? onCancel : undefined}
    className={className} />;
}
