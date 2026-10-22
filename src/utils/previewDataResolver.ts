/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type ExecutionContext from "@/utils/executionContext";
import type { SemanticNode } from "@/contexts/canonicalGraphStore";

interface PreviewDataResult {
  allNodeData: Record<string, any>;
  getSourceData: (sourceId: string) => any;
}

export function buildPreviewData(
  previousNodes: readonly SemanticNode[],
  executionStore: ExecutionContext,
  getNodes: () => readonly SemanticNode[],
  recordedOnly = false,
): PreviewDataResult {
  const allNodeData: Record<string, any> = Object.create(null);

  // History availability comes only from recorded results, never saved/pinned node data.
  if (recordedOnly) {
    previousNodes.forEach(node => {
      if (Object.prototype.hasOwnProperty.call(node.data, "output")) {
        allNodeData[node.id] = node.data.output;
      }
    });
    return { allNodeData, getSourceData: sourceId => allNodeData[sourceId] };
  }

  previousNodes.forEach((prevNode) => {
    const displayName = prevNode.id;

    let nodeData = executionStore.getNodeData(prevNode.id).output;
    if (nodeData === undefined) {
      nodeData = prevNode.data?.pinnedOutput ?? (prevNode.data?.output !== undefined ? prevNode.data.output : prevNode.data ?? {});
    }

    if (typeof displayName === "string") {
      allNodeData[displayName] = nodeData;
    }
  });

  const getSourceData = (sourceId: string) => {
    const nodes = getNodes();
    const srcNode = nodes.find((node) => node.id === sourceId);

    if (!srcNode) {
      return {};
    }

    const storeOutput = executionStore.getNodeData(sourceId).output;
    if (storeOutput !== undefined) {
      return storeOutput;
    }

    return srcNode.data?.pinnedOutput ?? (srcNode.data?.output !== undefined ? srcNode.data.output : srcNode.data ?? {});
  };

  return { allNodeData, getSourceData };
}
