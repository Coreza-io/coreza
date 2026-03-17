import { NodeResult, WorkflowEdge, WorkflowNode } from "../nodes/types";

type BranchOriginInfo = { ifNodeId: string; handle: string; edgeId: string };

export class GraphRuntime {
  readonly nodeById = new Map<string, WorkflowNode>();
  readonly subNodeIds = new Set<string>();
  readonly incomingEdgesByTarget = new Map<string, WorkflowEdge[]>();
  readonly outgoingEdgesBySource = new Map<string, WorkflowEdge[]>();
  readonly branchOrigins = new Map<string, Map<string, BranchOriginInfo>>();
  readonly requiredEdgeCounts = new Map<string, number>();

  constructor(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
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

    this.buildBranchOrigins(edges);
  }

  getIncomingEdges(targetId: string): WorkflowEdge[] {
    return this.incomingEdgesByTarget.get(targetId) ?? [];
  }

  getOutgoingEdges(sourceId: string): WorkflowEdge[] {
    return this.outgoingEdgesBySource.get(sourceId) ?? [];
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
