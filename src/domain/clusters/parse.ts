import type { NodeCluster } from './types';

export interface ParsedClusters {
  clusters: NodeCluster[];
  sourceIndexes?: number[];
  invalidIndexes: number[];
  invalidEntries: Array<{ index: number; value: unknown }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses the persisted shape without silently coercing or repairing invalid metadata. */
export function parseNodeClusters(value: unknown): ParsedClusters {
  if (!Array.isArray(value)) {
    return {
      clusters: [],
      invalidIndexes: value == null ? [] : [0],
      invalidEntries: value == null ? [] : [{ index: 0, value }],
    };
  }

  const clusters: NodeCluster[] = [];
  const sourceIndexes: number[] = [];
  const invalidIndexes: number[] = [];
  const invalidEntries: Array<{ index: number; value: unknown }> = [];

  value.forEach((candidate, index) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.title !== 'string' ||
      !Array.isArray(candidate.memberNodeIds) ||
      !candidate.memberNodeIds.every((memberId) => typeof memberId === 'string') ||
      (Object.prototype.hasOwnProperty.call(candidate, 'parentClusterId') && (typeof candidate.parentClusterId !== 'string' || !candidate.parentClusterId.trim())) ||
      (candidate.note !== undefined && typeof candidate.note !== 'string')
    ) {
      invalidIndexes.push(index);
      invalidEntries.push({ index, value: candidate });
      return;
    }

    const note = typeof candidate.note === 'string' ? candidate.note : undefined;
    sourceIndexes.push(index);
    clusters.push({
      id: candidate.id,
      title: candidate.title,
      ...(candidate.parentClusterId !== undefined ? { parentClusterId: candidate.parentClusterId as string } : {}),
      memberNodeIds: candidate.memberNodeIds,
      ...(note !== undefined ? { note } : {}),
    });
  });

  return { clusters, ...(sourceIndexes.length ? {sourceIndexes} : {}), invalidIndexes, invalidEntries };
}
