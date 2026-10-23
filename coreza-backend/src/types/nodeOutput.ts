/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export type { NodeResult as StandardNodeOutput, ResultStatus as NodeExecutionStatus,
  ResultMeta as NodeOutputMeta, ResultErrorDetails as StandardErrorDetails, NormalizeContext } from "../contracts/nodeResult";
export { isNodeResult as isStandardNodeOutput } from "../contracts/nodeResult";
import { isNodeResult } from "../contracts/nodeResult";
export const extractOutputData = <T = any>(output: any): T => isNodeResult(output) ? output.data : output;
