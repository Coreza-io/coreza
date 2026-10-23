/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/** Compatibility import facade. New producers use the explicit result constructors. */
import { decodeLegacyNodeResult, finalizeNodeResult, resultFailure, resultState, resultSuccess,
  NodeResultError, type NodeResult, type NormalizeContext } from "./nodeResult";
export { resultSuccess, resultFailure, resultState } from "./nodeResult";
export const normalizeOutput = (raw: unknown, context: NormalizeContext = {}): NodeResult =>
  finalizeNodeResult(decodeLegacyNodeResult(raw, "executor"), context, "observed");
/** Lossless compatibility name: canonical results are never projected back to the old envelope. */
export const toNodeResult = (output: NodeResult): NodeResult => output;
export const compactSuccess = resultSuccess;
export const compactError = resultFailure;
export const createSuccessOutput = <T>(data: T, context: NormalizeContext = {}): NodeResult<T> =>
  finalizeNodeResult(resultSuccess(data), context, "observed");
export const createErrorOutput = (error: unknown, context: NormalizeContext = {}): NodeResult =>
  finalizeNodeResult(error instanceof NodeResultError ? error.result : resultFailure(error instanceof Error ? error.message : typeof error === "string" ? error : "Node execution failed"), context, "observed");
export const createWaitingOutput = (message: string, data: any = {}, context: NormalizeContext = {}): NodeResult =>
  finalizeNodeResult(resultState("waiting", { message, ...data }), context, "observed");
export const createStreamingOutput = (data: any, context: NormalizeContext = {}): NodeResult =>
  finalizeNodeResult(resultState("streaming", data), context, "observed");
export const createPendingOutput = (context: NormalizeContext = {}): NodeResult =>
  finalizeNodeResult(resultState("pending", null), context, "observed");
export const createRunningOutput = (context: NormalizeContext = {}): NodeResult =>
  finalizeNodeResult(resultState("running", null), context, "observed");
