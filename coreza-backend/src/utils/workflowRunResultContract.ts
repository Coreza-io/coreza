import { readNodeResult, serializeNodeResult, serializeNodeResults, stringifyNodeResult, type NodeResult } from "../contracts/nodeResult";
import type { WorkflowExecutionResult } from "../engine/types";

export type RedisRunResultUpdate =
  | WorkflowExecutionResult
  | { result?: WorkflowExecutionResult; errorMessage?: string };

export function normalizeRedisRunResultUpdate(update: RedisRunResultUpdate): {
  result?: WorkflowExecutionResult;
  errorMessage?: string;
} {
  if ("result" in update || "errorMessage" in update) {
    return { result: update.result, errorMessage: update.errorMessage };
  }
  return { result: update };
}

/** Project only known result slots at a persistence boundary, including edge-keyed cluster outputs. */
export function serializeWorkflowRunResult(result: WorkflowExecutionResult): WorkflowExecutionResult {
  let publicError = result.error;
  if (publicError) {
    const { cause, ...diagnostic } = publicError;
    publicError = diagnostic;
  }
  return {
    ...result,
    nodeResults: serializeNodeResults(result.nodeResults),
    ...(publicError ? { error: publicError } : {}),
    ...(result.boundaryOutputs ? { boundaryOutputs: Object.fromEntries(Object.entries(result.boundaryOutputs).map(([edgeId, boundary]) => [edgeId, {
      ...boundary,
      value: boundary.value === undefined ? undefined : serializeNodeResult(readNodeResult(boundary.value)),
    }])) } : {}),
  };
}

/** Encode live history payloads once, with validation integrated into each node's JSON encoding. */
export function stringifyWorkflowRunResult(result: WorkflowExecutionResult): string {
  const { nodeResults, boundaryOutputs, error, ...runFields } = result;
  let publicError = error;
  if (publicError) { const { cause, ...diagnostic } = publicError; publicError = diagnostic; }
  // This cache lives only for this synchronous write, never across mutable bars/events.
  const encoded = new WeakMap<NodeResult, string>();
  const encodeNode = (value: NodeResult): string => {
    const node = readNodeResult(value);
    const cached = encoded.get(node);
    if (cached !== undefined) return cached;
    const json = stringifyNodeResult(node);
    encoded.set(node, json);
    return json;
  };
  const appendField = (json: string, key: string, valueJson: string): string =>
    `${json.slice(0, -1)}${json.length > 2 ? "," : ""}${JSON.stringify(key)}:${valueJson}}`;
  let json = appendField(JSON.stringify({ ...runFields, error: publicError }), "nodeResults",
    `{${Object.entries(nodeResults).map(([id, value]) => `${JSON.stringify(id)}:${encodeNode(value)}`).join(",")}}`);
  if (boundaryOutputs) {
    const boundaries = Object.entries(boundaryOutputs).map(([edgeId, boundary]) => {
      const { value, ...fields } = boundary;
      const boundaryJson = value === undefined ? JSON.stringify(fields) : appendField(JSON.stringify(fields), "value", encodeNode(value));
      return `${JSON.stringify(edgeId)}:${boundaryJson}`;
    });
    json = appendField(json, "boundaryOutputs", `{${boundaries.join(",")}}`);
  }
  return json;
}
