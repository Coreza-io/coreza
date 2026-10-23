/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createContext } from "react";

// History has no editing provider, even when an old snapshot contains callbacks.
export const EdgeEditingContext = createContext({
  sessionId: "",
  enabled: false,
  canEdit: () => false,
  deletableEdgeIds: new Set<string>(),
  removeEdge: (_edgeId: string) => {},
});
