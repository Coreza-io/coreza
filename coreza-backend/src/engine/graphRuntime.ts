import { NodeResult, WorkflowEdge, WorkflowNode } from "../nodes/types";

type BranchOriginInfo = { ifNodeId: string; handle: string; edgeId: string };

export class GraphRuntime {
  readonly nodeById = new Map<string, WorkflowNode>();
  readonly subNodeIds = new Set<string>();
  readonly incomingEdgesByTarget = new Map<string, WorkflowEdge[]>();
  readonly outgoingEdgesBySource = new Map<string, WorkflowEdge[]>();
  readonly branchOrigins = new Map<string, Map<string, BranchOriginInfo>>();
  readonly requiredEdgeCounts = new Map<string, number>();
  readonly entryNodeIds: readonly string[];

  constructor(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    this.validate(nodes, edges);

    for (const node of nodes) {
      this.nodeById.set(node.id, node);
      if ((node as any)?.node_type === "sub") this.subNodeIds.add(node.id);
    }

    for (const edge of edges) {
      (this.incomingEdgesByTarget.get(edge.target) ?? this.incomingEdgesByTarget.set(edge.target, []).get(edge.target)!).push(edge);
      (this.outgoingEdgesBySource.get(edge.source) ?? this.outgoingEdgesBySource.set(edge.source, []).get(edge.source)!).push(edge);
    }

    for (const node of nodes) {
      const incoming = this.getIncomingEdges(node.id);
      this.requiredEdgeCounts.set(
        node.id,
        incoming.filter((e) => !this.isSubNode(e.source)).length,
      );
    }

    this.entryNodeIds = nodes
      .filter((n) =>
        (n.node_type === "trigger" || n.node_type === "backtest") &&
        this.getIncomingEdges(n.id).length === 0,
      )
      .map((n) => n.id);

    this.buildBranchOrigins(edges);
  }

  private validate(nodes: WorkflowNode[], edges: WorkflowEdge[]): void {
    const ids = new Set<string>();
    for (const node of nodes) {
      if (ids.has(node.id)) {
        throw new Error(`[GraphRuntime] Duplicate node ID: ${node.id}`);
      }
      ids.add(node.id);
    }

    for (const edge of edges) {
      if (!ids.has(edge.source)) {
        throw new Error(`[GraphRuntime] Edge references missing source node: ${edge.source}`);
      }
      if (!ids.has(edge.target)) {
        throw new Error(`[GraphRuntime] Edge references missing target node: ${edge.target}`);
      }
    }
  }

  getIncomingEdges(targetId: string): WorkflowEdge[] {
    return this.incomingEdgesByTarget.get(targetId) ?? [];
  }

  getOutgoingEdges(sourceId: string): WorkflowEdge[] {
    return this.outgoingEdgesBySource.get(sourceId) ?? [];
  }

  topoSort(): string[] {
    const inDegree = new Map<string, number>();

    for (const nodeId of this.nodeById.keys()) {
      inDegree.set(nodeId, this.getIncomingEdges(nodeId).length);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(nodeId);
    }

    const topoOrder: string[] = [];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      topoOrder.push(nodeId);

      for (const edge of this.getOutgoingEdges(nodeId)) {
        const nextDegree = (inDegree.get(edge.target) ?? 1) - 1;
        inDegree.set(edge.target, nextDegree);
        if (nextDegree === 0) queue.push(edge.target);
      }
    }

    return topoOrder;
  }

  isLoopNode(nodeId: string): boolean {
    return this.nodeById.get(nodeId)?.name === "Loop";
  }

  isSubNode(nodeId: string): boolean {
    return this.subNodeIds.has(nodeId);
  }

  loopBodyEdges(loopId: string): WorkflowEdge[] {
    return this.getOutgoingEdges(loopId).filter(
      (edge) => !edge.sourceHandle || edge.sourceHandle === "loop",
    );
  }

  doneEdges(loopId: string): WorkflowEdge[] {
    return this.getOutgoingEdges(loopId).filter(
      (edge) => edge.sourceHandle === "done",
    );
  }

  selectEdges(node: WorkflowNode, result: NodeResult): WorkflowEdge[] {
    const outgoingEdges = this.getOutgoingEdges(node.id);
    if (node.name !== "If" && node.name !== "Switch") return outgoingEdges;

    const resultData = result?.data;
    let chosen: string[] = ["default", ""];

    if (typeof resultData === "boolean") {
      chosen = [resultData ? "true" : "false"];
    } else if (typeof resultData === "string") {
      chosen = [resultData];
    } else if (
      resultData &&
      typeof resultData === "object" &&
      ("true" in resultData || "false" in resultData)
    ) {
      chosen = Object.entries(resultData)
        .filter(([, value]) => !!value)
        .map(([key]) => key);
    }

    const allowed = new Set(chosen);
    return outgoingEdges.filter((edge) => allowed.has(edge.sourceHandle ?? ""));
  }

  private buildBranchOrigins(edges: WorkflowEdge[]): void {
    const conditionalMap = new Map<string, Record<string, string[]>>();

    for (const edge of edges) {
      const sourceNode = this.nodeById.get(edge.source);
      if (!(sourceNode?.name === "If" || sourceNode?.name === "Switch") || !edge.sourceHandle) continue;
      const entry = conditionalMap.get(edge.source) ?? {};
      (entry[edge.sourceHandle] ??= []).push(edge.target);
      conditionalMap.set(edge.source, entry);
    }

    for (const [ifNodeId, branchMap] of conditionalMap.entries() as IterableIterator<[string, Record<string, string[]>]>) {
      const handleReachable = new Map<string, Set<string>>();
      for (const [handle, targets] of Object.entries(branchMap) as [string, string[]][]) {
        const visited = new Set<string>();
        const stack = [...targets];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (visited.has(current)) continue;
          visited.add(current);
          for (const out of this.getOutgoingEdges(current)) stack.push(out.target);
        }
        handleReachable.set(handle, visited);
      }

      const nodeToHandles = new Map<string, Set<string>>();
      for (const [handle, nodes] of handleReachable.entries()) {
        for (const nodeId of nodes) {
          const handles = nodeToHandles.get(nodeId) ?? new Set<string>();
          handles.add(handle);
          nodeToHandles.set(nodeId, handles);
        }
      }

      for (const [targetNodeId, handles] of nodeToHandles.entries()) {
        if (handles.size < 2) continue;
        for (const incoming of this.getIncomingEdges(targetNodeId)) {
          const matchingHandles: string[] = [];
          for (const handle of handles) {
            const reachable = handleReachable.get(handle);
            const directFromBranchNode = incoming.source === ifNodeId && incoming.sourceHandle === handle;
            if (directFromBranchNode || reachable?.has(incoming.source)) matchingHandles.push(handle);
          }
          if (matchingHandles.length !== 1) continue;
          const targetOrigins = this.branchOrigins.get(targetNodeId) ?? new Map<string, BranchOriginInfo>();
          targetOrigins.set(incoming.id, { ifNodeId, handle: matchingHandles[0], edgeId: incoming.id });
          this.branchOrigins.set(targetNodeId, targetOrigins);
        }
      }
    }
  }
}
