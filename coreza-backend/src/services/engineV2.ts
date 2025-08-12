import { WorkflowNode, WorkflowEdge, INodeExecutorV2, Item, NodeExecutionOutput } from "../nodes/types";

/**
 * Experimental workflow engine (v2).
 * ---------------------------------------------------------------
 * This is an in-memory implementation that mirrors the high level
 * design discussed in the architecture plan. It is intentionally
 * minimal and focuses on the control flow semantics:
 *   - Nodes operate on arrays of items
 *   - Branching decisions are handled in the engine
 *   - Loop nodes can re-queue themselves until completion
 *
 * The goal of committing this skeleton is to provide a clear starting
 * point for the n8n-style execution model without disrupting the
 * existing engine. The implementation is not wired to persistence or
 * the scheduler yet but showcases the core queue-based algorithm.
 */
export class EngineV2 {
  private queue: string[] = [];
  private nodeState = new Map<string, any>();
  private nodeOutput = new Map<string, Item[]>();
  private executors = new Map<string, INodeExecutorV2>();

  constructor(
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[],
  ) {}

  registerExecutor(executor: INodeExecutorV2) {
    this.executors.set(executor.category, executor);
  }

  private getExecutor(node: WorkflowNode): INodeExecutorV2 {
    const exec = this.executors.get(node.category);
    if (!exec) {
      throw new Error(`No executor registered for category ${node.category}`);
    }
    return exec;
  }

  /** Push starting nodes (those without incoming edges) onto the queue. */
  private initializeQueue() {
    const starters = this.nodes.filter(n => !this.edges.some(e => e.target === n.id));
    this.queue.push(...starters.map(s => s.id));
  }

  async run(initialInput: Item[] = []) {
    this.initializeQueue();
    // Seed initial input for starter nodes
    const starters = this.nodes.filter(n => !this.edges.some(e => e.target === n.id));
    starters.forEach(node => this.nodeOutput.set(node.id, initialInput));

    while (this.queue.length > 0) {
      const nodeId = this.queue.shift()!;
      const node = this.nodes.find(n => n.id === nodeId);
      if (!node) continue;

      const input = this.nodeOutput.get(node.id) || [];
      const executor = this.getExecutor(node);
      const result = await executor.execute(node, node.values ?? {}, input, {
        getState: (key: string) => this.nodeState.get(`${node.id}:${key}`),
        setState: (key: string, value: any) => this.nodeState.set(`${node.id}:${key}`, value),
      });

      this.nodeOutput.set(node.id, result.output);

      if (result.control?.setState) {
        Object.entries(result.control.setState).forEach(([k, v]) => this.nodeState.set(`${node.id}:${k}`, v));
      }

      if (node.type === 'If') {
        this.propagate(node.id, result.control?.branch ?? 'true', result);
      } else if (node.type === 'Loop') {
        const handle = result.control?.requeueSelf ? 'loop' : 'done';
        this.propagate(node.id, handle, result);
        if (result.control?.requeueSelf) {
          // Re-queue the loop node after its children
          this.queue.push(node.id);
        }
      } else {
        this.propagate(node.id, undefined, result);
      }
    }
  }

  /**
   * Propagate items to children based on outgoing edges and handle name.
   */
  private propagate(sourceId: string, handle: string | undefined, result: NodeExecutionOutput) {
    const route = (items: Item[], h?: string) => {
      if (!items || items.length === 0) return;
      const outgoing = this.edges.filter(
        e => e.source === sourceId && (!h || e.sourceHandle === h)
      );
      for (const edge of outgoing) {
        const current = this.nodeOutput.get(edge.target) || [];
        // In this naive implementation we simply concatenate outputs
        this.nodeOutput.set(edge.target, current.concat(items));
        this.queue.push(edge.target);
      }
    };

    if (result.trueItems || result.falseItems) {
      route(result.trueItems ?? [], 'true');
      route(result.falseItems ?? [], 'false');
    } else {
      route(result.output, handle);
    }
  }
}

