/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { Node } from "@xyflow/react";
import type ExecutionContext from "@/utils/executionContext";

interface PreviewDataResult {
  allNodeData: Record<string, any>;
  getSourceData: (sourceId: string) => any;
}

export function buildPreviewData(
  previousNodes: Node[],
  executionStore: ExecutionContext,
  getNodes: () => Node[]
): PreviewDataResult {
  const allNodeData: Record<string, any> = {};

  previousNodes.forEach((prevNode) => {
    const displayName = prevNode.data?.displayName || prevNode.id;

    let nodeData = executionStore.getNodeData(prevNode.id).output;
    if (nodeData === undefined) {
      nodeData = prevNode.data?.output || prevNode.data || {};
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

    return srcNode.data?.output || srcNode.data || {};
  };

  return { allNodeData, getSourceData };
}
