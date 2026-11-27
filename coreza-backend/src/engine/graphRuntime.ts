import { NodeResult, WorkflowEdge, WorkflowNode } from "../nodes/types";
import { isFailedResult } from "../contracts/nodeResult";
import { buildBranchOrders, orderedReadyIndex, type OrderedBranches } from "./branchOrder";

type BranchOriginInfo = { ifNodeId: string; handle: string; edgeId: string };

interface DependencyDescriptor {
  readonly requiredCount: number;
  readonly independentEdgeIds: readonly string[];
  readonly branchGroups: readonly (readonly string[])[];
}

interface LoopScheduling {
  readonly feedbackEdgeIds: ReadonlySet<string>;
  readonly startup: DependencyDescriptor;
}

export class GraphRuntime {
  readonly nodeById = new Map<string, WorkflowNode>();
  readonly subNodeIds = new Set<string>();
  readonly incomingEdgesByTarget = new Map<string, WorkflowEdge[]>();
  readonly outgoingEdgesBySource = new Map<string, WorkflowEdge[]>();
  readonly branchOrigins = new Map<string, Map<string, BranchOriginInfo>>();
  readonly requiredEdgeCounts = new Map<string, number>();
  readonly dependenciesByTarget: ReadonlyMap<string, DependencyDescriptor>;
  readonly entryNodeIds: readonly string[];
  readonly orderedBranches: OrderedBranches | undefined;
  private readonly loopScheduling = new Map<string, LoopScheduling>();

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
    this.dependenciesByTarget = this.buildDependencies();
    this.orderedBranches = buildBranchOrders(nodes, edges);
  }

  private buildDependencies(): ReadonlyMap<string, DependencyDescriptor> {
    const descriptors = new Map<string, DependencyDescriptor>();
    for (const nodeId of this.nodeById.keys()) {
      descriptors.set(nodeId, this.describeDependencies(nodeId));
    }
    return descriptors;
  }

  private describeDependencies(nodeId: string, excludedEdges?: ReadonlySet<string>): DependencyDescriptor {
    const origins = this.branchOrigins.get(nodeId);
    const independent: string[] = [];
    const branchGroups = new Map<string, string[]>();
    let requiredCount = 0;
    for (const edge of this.getIncomingEdges(nodeId)) {
      if (this.isSubNode(edge.source) || excludedEdges?.has(edge.id)) continue;
      requiredCount++;
      const origin = origins?.get(edge.id);
      if (!origin) {
        independent.push(edge.id);
        continue;
      }
      const group = branchGroups.get(origin.ifNodeId) ?? [];
      group.push(edge.id);
      branchGroups.set(origin.ifNodeId, group);
    }
    return Object.freeze({
      requiredCount,
      independentEdgeIds: Object.freeze(independent),
      branchGroups: Object.freeze([...branchGroups.values()].map(group => Object.freeze(group))),
    });
  }

  getLoopScheduling(loopId: string): LoopScheduling {
    const cached = this.loopScheduling.get(loopId);
    if (cached) return cached;

    const body = new Set<string>();
    const pending = this.loopBodyEdges(loopId).map(edge => edge.target);
    while (pending.length) {
      const nodeId = pending.pop()!;
      // Stop at the owning Loop so its done path cannot lead back into the body.
      if (nodeId === loopId || this.isSubNode(nodeId) || body.has(nodeId)) continue;
      body.add(nodeId);
      for (const edge of this.getOutgoingEdges(nodeId)) pending.push(edge.target);
    }

    const feedbackEdgeIds = new Set(this.getIncomingEdges(loopId)
      .filter(edge => body.has(edge.source)).map(edge => edge.id));
    const scheduling = { feedbackEdgeIds, startup: this.describeDependencies(loopId, feedbackEdgeIds) };
    this.loopScheduling.set(loopId, scheduling);
    return scheduling;
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

  topoSort(excludedEdges?: ReadonlySet<string>): string[] {
    const inDegree = new Map<string, number>();

    for (const nodeId of this.nodeById.keys()) {
      const incoming = this.getIncomingEdges(nodeId);
      inDegree.set(nodeId, excludedEdges ? incoming.filter(edge => !excludedEdges.has(edge.id)).length : incoming.length);
    }

    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(nodeId);
    }

    const topoOrder: string[] = [];
    const priorities = this.orderedBranches?.priorities;
    while (queue.length > 0) {
      const index = priorities ? orderedReadyIndex(queue, 0, priorities, id => id) : 0;
      const nodeId = index === 0 ? queue.shift()! : queue.splice(index, 1)[0];
      topoOrder.push(nodeId);

      for (const edge of this.getOutgoingEdges(nodeId)) {
        if (excludedEdges?.has(edge.id)) continue;
        const nextDegree = (inDegree.get(edge.target) ?? 1) - 1;
        inDegree.set(edge.target, nextDegree);
        if (nextDegree === 0) queue.push(edge.target);
      }
    }

    return topoOrder;
  }

  getScheduledInputEdges(nodeId: string, sourceResults: Readonly<Record<string, NodeResult>>): WorkflowEdge[] {
    const downstream = new Set([nodeId]);
    const pending = [nodeId];
    while (pending.length > 0) {
      for (const edge of this.getOutgoingEdges(pending.pop()!)) {
        if (this.isSubNode(edge.target) || downstream.has(edge.target) || this.isLoopFeedbackEdge(edge)) continue;
        downstream.add(edge.target);
        pending.push(edge.target);
      }
    }

    const inputs: WorkflowEdge[] = [];
    for (const [id, result] of Object.entries(sourceResults)) {
      const node = this.nodeById.get(id);
      if (!node || this.isSubNode(id) || downstream.has(id) ||
        isFailedResult(result) || result.control?.suppressRouting || result.control?.parallelDistributed) continue;
      const edges = this.isLoopNode(id)
        ? (result.control?.loopCompleted ? this.doneEdges(id) : [])
        : this.selectEdges(node, result);
      for (const edge of edges) {
        if (edge.target !== nodeId && downstream.has(edge.target) && !this.isLoopFeedbackEdge(edge)) inputs.push(edge);
      }
    }
    return inputs;
  }

  private isLoopFeedbackEdge(edge: WorkflowEdge): boolean {
    return this.isLoopNode(edge.target) && this.getLoopScheduling(edge.target).feedbackEdgeIds.has(edge.id);
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
