/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/** Server error extraction stays outside the portable result contract. */
import axios from "axios";
import { createErrorOutput as baseErrorOutput } from "../contracts/output";
import { safeErrorDetails, type NormalizeContext, type NodeResult } from "../contracts/nodeResult";
export * from "../contracts/output";
export function createErrorOutput(error: unknown, context: NormalizeContext = {}): NodeResult {
  const output = baseErrorOutput(error, context);
  if (!axios.isAxiosError(error)) return output;
  const message = error.response?.data?.message;
  return { ...output, error: typeof message === "string" ? message : error.message,
    details: safeErrorDetails({ code: error.code, status: error.response?.status, response: error.response?.data }) };
}
