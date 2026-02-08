/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
