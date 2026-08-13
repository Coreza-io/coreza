export type BacktestPhase =
  | "initializing"
  | "warming_up"
  | "ready"
  | "running"
  | "finished";

export type WarmupMode = "seed" | "workflow_replay";
export type WarmupNodePolicy = "execute" | "suppress" | "reject";

export interface WarmupWarning {
  code: string;
  symbol?: string;
  requested?: number;
  available?: number;
  affectedNodes?: string[];
}
