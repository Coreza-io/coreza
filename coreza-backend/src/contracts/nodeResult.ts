/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/** Browser-safe node results. Workflow-run, HTTP and provider envelopes are separate contracts. */
export type ResultStatus = "pending" | "running" | "success" | "error" | "waiting" | "listening" | "streaming" | "skipped" | "cancelled" | "not-executed";
export interface ResultErrorDetails {
  code?: string;
  provider?: string;
  status?: number;
  recoverable?: boolean;
  reason?: string;
  response?: Record<string, string | number | boolean | null>;
}
export interface ResultMeta {
  timestamp?: string;
  executionTime?: number;
  durationMs?: number;
  nodeId?: string;
  nodeName?: string;
  category?: string;
  runId?: string;
  invocationId?: string;
  cached?: boolean;
  persistentVariableKeys?: string[];
  smoothing?: string;
  series?: unknown[];
  requiredBars?: number;
  [key: string]: unknown;
}
export interface RuntimeControl {
  suppressRouting?: boolean;
  ownedNodeResults?: Record<string, NodeResult>;
  ownedExecutionOrder?: string[];
  requeueSelf?: boolean;
  throttleUntil?: number;
  setState?: Record<string, any>;
  branch?: "true" | "false";
  loopCompleted?: boolean;
  loopIteration?: boolean;
  parallelDistributed?: boolean;
  sourceHandle?: string;
  currentIndex?: number;
  isLastBatch?: boolean;
  itemCount?: number;
  loopId?: string;
  maxConcurrency?: number;
  continueOnError?: boolean;
  cancelled?: boolean;
}
export interface NodeResult<T = any> {
  status: ResultStatus;
  data: T | null;
  error?: string;
  details?: ResultErrorDetails;
  meta?: ResultMeta;
  control?: RuntimeControl;
  warmupSuppressed?: boolean;
}
export type ResultOptions = Pick<NodeResult, "details" | "meta" | "control" | "warmupSuppressed">;
export interface NormalizeContext {
  nodeId?: string; nodeName?: string; category?: string; runId?: string; invocationId?: string;
  startTime?: number; timestamp?: string; executionTime?: number; skipTimestamp?: boolean;
}
const statuses: readonly string[] = ["pending", "running", "success", "error", "waiting", "listening", "streaming", "skipped", "cancelled", "not-executed"];
const resultKeys = new Set(["status", "data", "error", "details", "meta", "control", "warmupSuppressed"]);
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
export function isNodeResult(value: unknown): value is NodeResult {
  if (!record(value) || !statuses.includes(value.status) || !owns(value, "data") || value.data === undefined
    || owns(value, "success") || owns(value, "formatVersion")
    || (value.error !== undefined && typeof value.error !== "string")) return false;
  for (const key in value) if (owns(value, key) && !resultKeys.has(key)) return false;
  return true;
}
export const isFailedResult = (result: NodeResult): boolean => result.status === "error";
export const isCompletedResult = (result: NodeResult): boolean => ["success", "error", "skipped", "cancelled", "not-executed"].includes(result.status);
export const isSuccessfulResult = (result: NodeResult): boolean => result.status === "success";
export const getNodePayload = <T>(result: NodeResult<T>): T | null => result.data;
export const getNodeDiagnostic = (result: NodeResult) => result.error === undefined && result.details === undefined ? undefined : { message: result.error, ...result.details };
export function resultState<T>(status: ResultStatus, data: T, options: ResultOptions = {}): NodeResult<T> {
  return { status, data: data === undefined ? null : data, ...options };
}
export const resultSuccess = <T>(data: T, options: ResultOptions = {}): NodeResult<T> => resultState("success", data, options);
export function resultFailure(message: string, options: ResultOptions & { data?: any } = {}): NodeResult {
  const { data = null, ...rest } = options;
  return { status: "error", data, error: message, ...rest };
}
/** Only explicitly permitted scalar response diagnostics cross a public boundary. */
export function safeErrorDetails(value: unknown): ResultErrorDetails | undefined {
  if (typeof value === "string") return { reason: value };
  if (!record(value)) return undefined;
  const details: ResultErrorDetails = {};
  for (const key of ["code", "provider", "reason"] as const) if (typeof value[key] === "string") details[key] = value[key];
  if (typeof value.status === "number" && Number.isFinite(value.status)) details.status = value.status;
  if (typeof value.recoverable === "boolean") details.recoverable = value.recoverable;
  if (record(value.response)) {
    const response: NonNullable<ResultErrorDetails["response"]> = {};
    for (const key of ["message", "error", "code", "status", "reason", "requestId"]) {
      const field = value.response[key];
      if (field === null || typeof field === "string" || typeof field === "boolean" || (typeof field === "number" && Number.isFinite(field))) response[key] = field;
    }
    if (Object.keys(response).length) details.response = Object.keys(response).length === Object.keys(value.response).length
      && Object.keys(response).every(key => Object.is(response[key], value.response[key])) ? value.response : response;
  }
  if (!Object.keys(details).length) return undefined;
  return Object.keys(details).length === Object.keys(value).length
    && Object.keys(details).every(key => Object.is(details[key as keyof ResultErrorDetails], value[key])) ? value as ResultErrorDetails : details;
}
/** Reject noncanonical values instead of guessing an older output format. */
export function readNodeResult(value: unknown): NodeResult {
  return isNodeResult(value) ? value : resultFailure("Expected a status/data node result", { details: { code: "INVALID_NODE_RESULT" } });
}
/** No clock reads: timing is captured by the invocation owner, never by a reader. */
export function finalizeNodeResult<T>(result: NodeResult<T>, context: NormalizeContext = {}, profile: "hot" | "observed" = "hot"): NodeResult<T> {
  if (profile === "hot") return result;
  const additions: ResultMeta = {};
  for (const key of ["nodeId", "nodeName", "category", "runId", "invocationId", "timestamp", "executionTime"] as const) {
    if (context[key] !== undefined && result.meta?.[key] === undefined) (additions as Record<string, unknown>)[key] = context[key];
  }
  return Object.keys(additions).length ? { ...result, meta: { ...additions, ...result.meta } } : result;
}
export function toPublicNodeResult<T>(result: NodeResult<T>, options: { omitSeries?: boolean } = {}): NodeResult<T> {
  const rawDetails = result.details;
  let meta = result.meta;
  if (options.omitSeries && meta && owns(meta, "series")) { const { series, ...rest } = meta; meta = rest; }
  const details = safeErrorDetails(rawDetails);
  if (!owns(result, "control") && details === rawDetails && meta === result.meta) return result;
  const { control, details: omittedDetails, ...publicResult } = result;
  return { ...publicResult, ...(meta ? { meta } : {}), ...(details ? { details } : {}) };
}
/** Shared JSON value policy; it does not recurse or run on the execution hot path. */
function assertSerializableValue(value: unknown): void {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (value instanceof Date) {
    if (Number.isFinite(value.getTime()) && value.toJSON === Date.prototype.toJSON
      && value.toISOString === Date.prototype.toISOString) return;
    throw new Error("Unsupported node output date");
  }
  if (typeof value !== "object") throw new Error("Unsupported node output");
  const proto = Object.getPrototypeOf(value);
  if ((!Array.isArray(value) && proto !== Object.prototype && proto !== null)
    || typeof (value as { toJSON?: unknown }).toJSON === "function") throw new Error("Unsupported node output instance");
}
/** Validate only at real object transport boundaries; unsupported data produces a diagnostic. */
export function serializeNodeResult(result: NodeResult, options: { omitSeries?: boolean } = {}): NodeResult {
  const ancestors = new Set<object>();
  const visit = (value: unknown): void => {
    assertSerializableValue(value);
    if (value === null || typeof value !== "object" || value instanceof Date) return;
    if (ancestors.has(value)) throw new Error("Cyclic node output");
    ancestors.add(value); Object.values(value).forEach(visit); ancestors.delete(value);
  };
  try {
    const publicResult = toPublicNodeResult(result, options);
    visit(publicResult);
    return publicResult;
  } catch { return resultFailure("Node output cannot be serialized", { details: { code: "OUTPUT_NOT_SERIALIZABLE" } }); }
}
/** Validate during JSON encoding, without a separate recursive payload pre-scan. */
export function stringifyNodeResult(result: NodeResult): string {
  try {
    const json = JSON.stringify(toPublicNodeResult(result), function (this: Record<string, unknown>, key: string, value: unknown) {
      // JSON calls toJSON before the replacer, so validate the original value too.
      assertSerializableValue(this[key]);
      return value;
    });
    if (json === undefined) throw new Error("Missing node output");
    return json;
  } catch {
    return JSON.stringify(resultFailure("Node output cannot be serialized", { details: { code: "OUTPUT_NOT_SERIALIZABLE" } }));
  }
}
export class NodeResultError extends Error {
  constructor(readonly result: NodeResult) { super(result.error ?? "Node execution failed"); this.name = "NodeResultError"; }
}
/** Public persistence projection; call at serialization, never in the per-node execution loop. */
export function serializeNodeResults(results: Record<string, unknown>): Record<string, NodeResult> {
  return Object.fromEntries(Object.entries(results).map(([id, value]) => [id, serializeNodeResult(readNodeResult(value))]));
}
