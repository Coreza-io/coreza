/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export * from "../../coreza-backend/src/contracts/nodeResult";
import { readNodeResult, toPublicNodeResult } from "../../coreza-backend/src/contracts/nodeResult";
/** Saved/UI ingress has no ownership of engine routing control. */
export const readPublicNodeResult = (value: unknown) => toPublicNodeResult(readNodeResult(value));
