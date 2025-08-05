export interface NodeExecutionData {
  input?: any;
  output?: any;
  loopItems?: any[];
  loopIndex?: number;
  loopItem?: any;
}

export class ExecutionContext {
  private store = new Map<string, NodeExecutionData>();

  constructor(initialNodes: Array<{ id: string; data?: NodeExecutionData }> = []) {
    initialNodes.forEach(n => {
      this.store.set(n.id, { ...(n.data || {}) });
    });
  }

  getNodeData(id: string): NodeExecutionData {
    return this.store.get(id) || {};
  }

  setNodeData(id: string, data: Partial<NodeExecutionData>) {
    const prev = this.store.get(id) || {};
    this.store.set(id, { ...prev, ...data });
  }
}

export default ExecutionContext;
