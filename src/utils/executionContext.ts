export interface NodeExecutionData {
  input?: any;
  output?: any;
  // Loop metadata
  isLoopNode?: boolean;
  items?: any[];
  loopItems?: any[];
  batchSize?: number;
  totalItems?: number;
  parallel?: boolean;
  continueOnError?: boolean;
  throttleMs?: number;
  loopIndex?: number;
  loopItem?: any;
}

export class ExecutionContext {
  private store = new Map<string, NodeExecutionData>();

  constructor(initial: Array<{ id: string; data?: NodeExecutionData }> = []) {
    initial.forEach(n => this.store.set(n.id, { ...(n.data || {}) }));
  }

  getNodeData(id: string): NodeExecutionData {
    return this.store.get(id) ?? {};
  }

  setNodeData(id: string, data: Partial<NodeExecutionData>): void {
    const prev = this.store.get(id) ?? {};
    this.store.set(id, { ...prev, ...data });
  }
}

export default ExecutionContext;
