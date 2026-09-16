export const MAX_CLUSTER_NOTE_LENGTH = 200;

export interface NodeCluster {
  id: string;
  title: string;
  memberNodeIds: string[];
  note?: string;
}

export type ClusterViolationCode =
  | 'duplicate-cluster-id'
  | 'invalid-cluster-id'
  | 'duplicate-title'
  | 'empty-title'
  | 'note-too-long'
  | 'empty-cluster'
  | 'too-few-members'
  | 'duplicate-member'
  | 'missing-member'
  | 'overlapping-membership'
  | 'trigger-member'
  | 'unknown-semantics'
  | 'shared-attachment'
  | 'attachment-boundary'
  | 'disconnected-members'
  | 'multiple-entry-members'
  | 'multiple-exit-members'
  | 'entry-not-root'
  | 'exit-not-leaf'
  | 'no-entry-exit-path';

export interface ClusterViolation {
  code: ClusterViolationCode;
  clusterId?: string;
  nodeIds: string[];
  edgeIds: string[];
  message: string;
}

export interface ClusterValidationResult {
  valid: boolean;
  violations: ClusterViolation[];
  resolvedMemberNodeIds?: string[];
}
