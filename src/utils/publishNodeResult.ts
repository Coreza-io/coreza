/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */
import { readNodeResult, toPublicNodeResult, type NodeResult } from "./nodeResult";

/** Publish one accepted result to all owners, followed by exactly one notification. */
export function publishNodeResult(
  value: unknown,
  owner: {
    nodeId: string;
    isCurrent: () => boolean;
    updateNodeData: (id: string, patch: Record<string, any>) => boolean | void;
    store: { setNodeData: (id: string, patch: Record<string, any>) => void };
    notify: () => void;
    setLastOutput?: (result: NodeResult) => void;
  },
  patch: Record<string, any> = {},
): NodeResult | undefined {
  if (!owner.isCurrent()) return;
  const result = toPublicNodeResult(readNodeResult(value));
  if (owner.updateNodeData(owner.nodeId, { ...patch, output: result }) === false) return;
  owner.store.setNodeData(owner.nodeId, { ...patch, output: result });
  owner.setLastOutput?.(result);
  owner.notify();
  return result;
}
