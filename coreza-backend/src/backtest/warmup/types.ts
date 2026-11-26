export type BacktestPhase =
  | "initializing"
  | "warming_up"
  | "ready"
  | "running"
  | "finished";

export interface WarmupWarning {
  code: string;
  symbol?: string;
  requested?: number;
  available?: number;
  affectedNodes?: string[];
}
