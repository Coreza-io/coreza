export interface Condition {
  left: string;
  operator: string;
  right: string;
}

export interface LogicNodeResult {
  success: boolean;
  outputEdgeId?: string;
  error?: string;
}

export enum LogicNodeType {
  IF = 'if',
  SWITCH = 'switch',
  LOOP = 'loop'
}

export interface IfNodeData {
  conditions: Condition[];
  operator: 'AND' | 'OR';
}

export interface SwitchNodeData {
  variable: string;
  cases: Array<{
    value: string;
    edgeId: string;
  }>;
  defaultEdgeId?: string;
}

export interface LoopNodeData {
  condition: Condition;
  maxIterations?: number;
}