/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */
import { finalizeNodeResult, resultFailure, resultSuccess,
  NodeResultError, type NodeResult, type NormalizeContext } from "./nodeResult";
export * from "./nodeResult";
export const createSuccessOutput = <T>(data: T, context?: NormalizeContext): NodeResult<T> =>
  context === undefined ? resultSuccess(data) : finalizeNodeResult(resultSuccess(data), context, "observed");
export const createErrorOutput = (error: unknown, context: NormalizeContext = {}): NodeResult =>
  finalizeNodeResult(error instanceof NodeResultError ? error.result : resultFailure(error instanceof Error ? error.message : typeof error === "string" ? error : "Node execution failed"), context, "observed");
