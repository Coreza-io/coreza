import { createHash } from "crypto";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import {
  getPersistedEdgeKind,
  PersistedNodeCluster,
  validateNodeClusterDocument,
} from "./validateNodeClusters";

export type ExecutionScope =
  | { kind: "workflow" }
  | { kind: "cluster"; clusterId: string };

export type MemberOutcome =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "pinned"
  | "branch_skipped"
  | "dependency_blocked"
  | "attachment_only";

export type BoundaryValueProvenance = "explicit" | "pinned_upstream" | "editor_snapshot";

export interface BoundaryInput {
  value: unknown;
  provenance?: BoundaryValueProvenance;
}

export interface EntryActivation {
  nodeId: string;
  inputs: Array<{
    edgeId: string;
    sourceNodeId: string;
    sourceHandle?: string;
    targetHandle?: string;
    value: unknown;
    provenance: BoundaryValueProvenance;
  }>;
}

export interface ClusterExecutionPlan {
  workflowId: string;
  sourceRevision: number;
  clusterId: string;
  titleSnapshot: string;
  memberNodeIds: string[];
  executableNodeIds: string[];
  attachmentNodeIds: string[];
  internalMainEdges: WorkflowEdge[];
  internalAttachmentEdges: WorkflowEdge[];
  boundaryInputEdges: WorkflowEdge[];
  boundaryOutputEdges: WorkflowEdge[];
  entryActivations: EntryActivation[];
  referenceContext: Readonly<Record<string, unknown>>;
  pinnedResults: Readonly<Record<string, unknown>>;
  executionMode: "manual";
  failurePolicy: "fail-fast";
  planHash: string;
}

export type ClusterPreflightCode =
  | "cluster_missing"
  | "invalid_saved_cluster"
  | "unsupported_execution_context"
  | "missing_boundary_input"
  | "invalid_reference_snapshot"
  | "unsupported_cycle"
  | "missing_credentials"
  | "empty_executable_scope";

export class ClusterPreflightError extends Error {
  readonly statusCode = 400;
  readonly isOperational = true;

  constructor(
    readonly code: ClusterPreflightCode,
    readonly details: { clusterId?: string; nodeIds?: string[]; edgeIds?: string[] } = {},
  ) {
    super(code);
    this.name = "ClusterPreflightError";
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

export interface ClusterWorkflowSnapshot {
  id: string;
  revision: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  node_clusters: PersistedNodeCluster[];
}

export interface CompileClusterPlanInput {
  workflow: ClusterWorkflowSnapshot;
  clusterId: string;
  boundaryInputs?: Readonly<Record<string, BoundaryInput>>;
  referenceSnapshots?: Readonly<Record<string, unknown>>;
}

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const MAX_SNAPSHOT_DEPTH = 20;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PLANNER_VERSION = 1;

function validateSnapshot(value: unknown, code: ClusterPreflightCode, depth = 0): void {
  if (depth > MAX_SNAPSHOT_DEPTH) throw new ClusterPreflightError(code);
  if (Array.isArray(value)) {
    value.forEach((item) => validateSnapshot(item, code, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) throw new ClusterPreflightError(code);
      validateSnapshot(item, code, depth + 1);
    }
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function hasUnsupportedCycle(
  executableNodeIds: readonly string[],
  edges: readonly WorkflowEdge[],
  nodeById: ReadonlyMap<string, WorkflowNode>,
): boolean {
  const inDegree = new Map(executableNodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    // A return to Loop.in is the one cycle shape supported by the existing
    // runtime; cluster document validation verifies the rest of that topology.
    if (nodeById.get(edge.target)?.name === "Loop" &&
        (edge.targetHandle == null || edge.targetHandle === "in")) continue;
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }
  const queue = [...inDegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const edge of edges) {
      if (edge.source !== id || (nodeById.get(edge.target)?.name === "Loop" &&
          (edge.targetHandle == null || edge.targetHandle === "in"))) continue;
      const next = (inDegree.get(edge.target) ?? 1) - 1;
      inDegree.set(edge.target, next);
      if (next === 0) queue.push(edge.target);
    }
  }
  return visited !== executableNodeIds.length;
}

function pinnedValue(node: WorkflowNode): { pinned: boolean; value?: unknown } {
  if (Object.prototype.hasOwnProperty.call(node, "pinnedOutput")) {
    return { pinned: true, value: node.pinnedOutput };
  }
  if (node.data && Object.prototype.hasOwnProperty.call(node.data, "pinnedOutput")) {
    return { pinned: true, value: node.data.pinnedOutput };
  }
  const values = node.values ?? node.data?.values;
  if (!values || values.pinned !== true || !("pinnedValue" in values)) return { pinned: false };
  return { pinned: true, value: values.pinnedValue };
}

function cloneEdge(edge: WorkflowEdge): WorkflowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle !== undefined ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle !== undefined ? { targetHandle: edge.targetHandle } : {}),
  };
}

export function compileClusterExecutionPlan(input: CompileClusterPlanInput): ClusterExecutionPlan {
  const { workflow, clusterId } = input;
  try {
    validateNodeClusterDocument(workflow);
  } catch (error) {
    throw new ClusterPreflightError("invalid_saved_cluster", { clusterId });
  }
  const cluster = workflow.node_clusters.find((item) => item.id === clusterId);
  if (!cluster) throw new ClusterPreflightError("cluster_missing", { clusterId });

  validateSnapshot(input.boundaryInputs ?? {}, "missing_boundary_input");
  validateSnapshot(input.referenceSnapshots ?? {}, "invalid_reference_snapshot");
  const snapshotBytes = Buffer.byteLength(JSON.stringify([input.boundaryInputs ?? {}, input.referenceSnapshots ?? {}]));
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) throw new ClusterPreflightError("invalid_reference_snapshot", { clusterId });

  const memberIds = new Set(cluster.memberNodeIds);
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const internalMainEdges: WorkflowEdge[] = [];
  const internalAttachmentEdges: WorkflowEdge[] = [];
  const boundaryInputEdges: WorkflowEdge[] = [];
  const boundaryOutputEdges: WorkflowEdge[] = [];
  for (const edge of workflow.edges) {
    const sourceInside = memberIds.has(edge.source);
    const targetInside = memberIds.has(edge.target);
    if (!sourceInside && !targetInside) continue;
    const kind = getPersistedEdgeKind(edge, nodeById.get(edge.source)!, nodeById.get(edge.target)!);
    if (!kind) throw new ClusterPreflightError("invalid_saved_cluster", { clusterId, edgeIds: [edge.id] });
    if (sourceInside && targetInside) (kind === "main" ? internalMainEdges : internalAttachmentEdges).push(edge);
    else if (kind === "attachment") throw new ClusterPreflightError("invalid_saved_cluster", { clusterId, edgeIds: [edge.id] });
    else if (targetInside) boundaryInputEdges.push(edge);
    else boundaryOutputEdges.push(edge);
  }

  const attachmentNodeIds = cluster.memberNodeIds.filter((id) => nodeById.get(id)?.node_type === "sub").sort();
  const executableNodeIds = cluster.memberNodeIds.filter((id) => nodeById.get(id)?.node_type !== "sub").sort();
  if (executableNodeIds.length === 0) throw new ClusterPreflightError("empty_executable_scope", { clusterId });
  if (hasUnsupportedCycle(executableNodeIds, internalMainEdges, nodeById)) {
    throw new ClusterPreflightError("unsupported_cycle", { clusterId, nodeIds: executableNodeIds });
  }

  const supplied = input.boundaryInputs ?? {};
  const missing = boundaryInputEdges.filter((edge) => !Object.prototype.hasOwnProperty.call(supplied, edge.id));
  if (missing.length > 0) throw new ClusterPreflightError("missing_boundary_input", { clusterId, edgeIds: missing.map(({ id }) => id) });
  const unknownBoundaryIds = Object.keys(supplied).filter((id) => !boundaryInputEdges.some((edge) => edge.id === id));
  if (unknownBoundaryIds.length > 0) throw new ClusterPreflightError("missing_boundary_input", { clusterId, edgeIds: unknownBoundaryIds });

  const activationByNode = new Map<string, EntryActivation>();
  for (const edge of boundaryInputEdges.sort((a, b) => a.id.localeCompare(b.id))) {
    const boundary = supplied[edge.id];
    const activation = activationByNode.get(edge.target) ?? { nodeId: edge.target, inputs: [] };
    activation.inputs.push({
      edgeId: edge.id,
      sourceNodeId: edge.source,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      value: boundary.value,
      provenance: boundary.provenance ?? "explicit",
    });
    activationByNode.set(edge.target, activation);
  }
  const incomingInternal = new Set(internalMainEdges.map(({ target }) => target));
  for (const nodeId of executableNodeIds) {
    if (!incomingInternal.has(nodeId) && !activationByNode.has(nodeId)) activationByNode.set(nodeId, { nodeId, inputs: [] });
  }

  const pinnedResults: Record<string, unknown> = {};
  for (const nodeId of executableNodeIds) {
    const pin = pinnedValue(nodeById.get(nodeId)!);
    if (pin.pinned) pinnedResults[nodeId] = { success: true, status: "pinned", data: pin.value };
  }
  const hashMaterial = stable({
    plannerVersion: PLANNER_VERSION,
    workflowId: workflow.id,
    sourceRevision: workflow.revision,
    cluster,
    nodes: cluster.memberNodeIds.map((id) => nodeById.get(id)),
    internalMainEdges,
    internalAttachmentEdges,
    boundaryInputEdges,
    boundaryOutputEdges,
    boundaryInputs: input.boundaryInputs ?? {},
    referenceSnapshots: input.referenceSnapshots ?? {},
    pinnedResults,
    executionMode: "manual",
  });
  return deepFreeze({
    workflowId: workflow.id,
    sourceRevision: workflow.revision,
    clusterId,
    titleSnapshot: cluster.title,
    memberNodeIds: [...cluster.memberNodeIds].sort(),
    executableNodeIds,
    attachmentNodeIds,
    internalMainEdges: internalMainEdges.map(cloneEdge).sort((a, b) => a.id.localeCompare(b.id)),
    internalAttachmentEdges: internalAttachmentEdges.map(cloneEdge).sort((a, b) => a.id.localeCompare(b.id)),
    boundaryInputEdges: boundaryInputEdges.map(cloneEdge).sort((a, b) => a.id.localeCompare(b.id)),
    boundaryOutputEdges: boundaryOutputEdges.map(cloneEdge).sort((a, b) => a.id.localeCompare(b.id)),
    entryActivations: [...activationByNode.values()].sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
    referenceContext: Object.freeze({ ...(input.referenceSnapshots ?? {}) }),
    pinnedResults: Object.freeze(pinnedResults),
    executionMode: "manual",
    failurePolicy: "fail-fast",
    planHash: createHash("sha256").update(JSON.stringify(hashMaterial)).digest("hex"),
  });
}
