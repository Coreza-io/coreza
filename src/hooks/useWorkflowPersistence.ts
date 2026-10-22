import { recoverClusterDocument } from '@/domain/clusters/recovery';
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Node, Edge } from '@xyflow/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkflowVersioning } from '@/hooks/useWorkflowVersioning';
import { nodeManifest } from '@/nodes/manifest';
import { reconcileNodeValues } from '@/utils/reconcileNodeValues';
import type { NodeCluster } from '@/domain/clusters/types';
import { normalizeClusters, validateClusters } from '@/domain/clusters/validate';
import { apiClient } from '@/lib/apiClient';
import { hashEditableWorkflowContent, savedWorkflowFromRow, serializeWorkflowContent } from '@/domain/workflowDocument';

export interface WorkflowPersistenceOptions {
  projectId: string | null;
  workflowId?: string | null;
}

export interface SaveOptions {
  skipConfirmation?: boolean;
}

export interface LoadedWorkflow {
  name: string;
  isActive: boolean;
  nodes: Node[];
  edges: Edge[];
  clusters: NodeCluster[];
  invalidClusterEntries: Array<{ index: number; value: unknown }>;
  revision: number;
}

/**
 * Checks if saving would cause significant node reduction (>50% from a workflow with >5 nodes).
 * Returns { shouldWarn, currentCount } so the caller can show a confirmation dialog.
 */
export interface NodeReductionCheck {
  shouldWarn: boolean;
  currentCount: number;
}

export const useWorkflowPersistence = ({ projectId, workflowId: documentId }: WorkflowPersistenceOptions) => {
  const { user: authUser, session } = useAuth();
  const scope = useMemo(() => ({}), [authUser?.id, documentId]);
  const currentScope = useRef<object | null>(scope);
  currentScope.current = scope;
  useEffect(() => {
    currentScope.current = scope;
    setLoading(false); setSaving(false);
    revisionRef.current = null; lastSavedHashRef.current = "";
    return () => { if (currentScope.current === scope) currentScope.current = null; };
  }, [scope]);
  const { shouldBlockEmptySave } = useWorkflowVersioning();

  const [hierarchySupported, setHierarchySupported] = useState(false);
  useEffect(() => {
    let live = true;
    setHierarchySupported(false);
    if (session?.access_token) void apiClient.get('/workflows/capabilities', session.access_token)
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (live) setHierarchySupported(data?.cluster_format_version === 2 && data?.max_cluster_depth === 2); })
      .catch(() => { if (live) setHierarchySupported(false); });
    return () => { live = false; };
  }, [session?.access_token]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastSavedHashRef = useRef<string>('');
  const revisionRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);

  // ──────────────────────────────────────────────
  // Unsaved-change tracking via simple JSON hash
  // ──────────────────────────────────────────────
  const computeHash = useCallback(
    (nodes: Node[], edges: Edge[], name: string, clusters: readonly NodeCluster[] = []) => {
      return hashEditableWorkflowContent(serializeWorkflowContent(name, projectId, nodes, edges, clusters));
    },
    [projectId],
  );

  const markSaved = useCallback(
    (nodes: Node[], edges: Edge[], name: string, clusters: readonly NodeCluster[] = []) => {
      lastSavedHashRef.current = computeHash(nodes, edges, name, clusters);
    },
    [computeHash],
  );

  const hasUnsavedChanges = useCallback(
    (nodes: Node[], edges: Edge[], name: string, clusters: readonly NodeCluster[] = []) =>
      lastSavedHashRef.current !== '' &&
      computeHash(nodes, edges, name, clusters) !== lastSavedHashRef.current,
    [computeHash],
  );

  // ──────────────────────────────────────────────
  // Check node reduction before save (for confirmation dialog)
  // ──────────────────────────────────────────────
  const checkNodeReduction = useCallback(
    async (workflowId: string, newNodeCount: number): Promise<NodeReductionCheck> => {
      try {
        const { data: current } = await supabase
          .from('workflows')
          .select('nodes')
          .eq('id', workflowId)
          .single();

        if (current) {
          const currentNodes = current.nodes as any[];
          const currentCount = Array.isArray(currentNodes) ? currentNodes.length : 0;
          if (currentCount > 5 && newNodeCount < currentCount * 0.5) {
            return { shouldWarn: true, currentCount };
          }
        }
      } catch (error) {
        console.warn('Could not check current workflow state:', error);
      }
      return { shouldWarn: false, currentCount: 0 };
    },
    [],
  );

  // ──────────────────────────────────────────────
  // SAVE
  // ──────────────────────────────────────────────
  const saveWorkflow = useCallback(
    async (
      workflowId: string | null,
      workflowName: string,
      nodes: Node[],
      edges: Edge[],
      opts: { isNew?: boolean; clusters?: readonly NodeCluster[] } = {},
    ): Promise<{ success: boolean; newId?: string; revision?: number }> => {
      if (!authUser || currentScope.current !== scope) {
        toast({
          title: 'Error',
          description: 'Please log in to save workflows',
          variant: 'destructive',
        });
        return { success: false };
      }

      if (saveInFlightRef.current) return { success: false };

      saveInFlightRef.current = true;
      setSaving(true);

      try {
        const candidateClusters = opts.clusters ?? [];
        if (candidateClusters.some(c=>c.parentClusterId !== undefined) && !hierarchySupported) throw new Error('The server has not confirmed hierarchy write support.');
        const clusterValidation = validateClusters(nodes, edges, candidateClusters);
        if (!clusterValidation.valid) {
          toast({
            title: 'Save Blocked',
            description: clusterValidation.violations[0].message,
            variant: 'destructive',
          });
          return { success: false };
        }
        const clusters = normalizeClusters(candidateClusters);
        // Block empty saves for existing workflows
        if (workflowId && !opts.isNew) {
          const shouldBlock = await shouldBlockEmptySave(workflowId, nodes.length);
          if (currentScope.current !== scope) return { success: false };
          if (shouldBlock) {
            toast({
              title: 'Save Blocked',
              description:
                'Cannot save: This would overwrite your workflow with an empty state. If intentional, delete the workflow instead.',
              variant: 'destructive',
            });
            return { success: false };
          }

        }

        const snapshot = serializeWorkflowContent(workflowName, projectId, nodes, edges, clusters);
        const payload = {
          name: snapshot.name,
          nodes: snapshot.nodes,
          edges: snapshot.edges,
          node_clusters: snapshot.clusters,
          ...(hierarchySupported ? { cluster_format_version: 2 } : {}),
          project_id: snapshot.projectId,
          ...(workflowId && !opts.isNew ? { expected_revision: revisionRef.current } : {}),
        };

        if (workflowId && !opts.isNew) {
          const response = await apiClient.put(`/workflows/${workflowId}`, payload, session?.access_token);
          if (!response.ok) {
            if (response.status === 409) throw new Error('This workflow changed in another session. Reload it or keep this draft and retry.');
            throw new Error((await response.json() as { message?: string }).message || 'Save failed');
          }
          const { workflow: row } = await response.json();
          const workflow = savedWorkflowFromRow(row);
          if (currentScope.current !== scope) return { success: false };
          revisionRef.current = workflow.revision;
          lastSavedHashRef.current = hashEditableWorkflowContent(workflow.content);
          toast({ title: 'Success', description: 'Workflow updated!' });
          return { success: true, newId: workflow.workflowId, revision: workflow.revision };
        } else {
          const response = await apiClient.post('/workflows', payload, session?.access_token);
          if (!response.ok) throw new Error((await response.json() as { message?: string }).message || 'Save failed');
          const { workflow: row } = await response.json();
          const workflow = savedWorkflowFromRow(row);
          if (currentScope.current !== scope) return { success: false };
          revisionRef.current = workflow.revision;
          lastSavedHashRef.current = hashEditableWorkflowContent(workflow.content);
          toast({ title: 'Success', description: 'Workflow saved!' });
          return { success: true, newId: workflow.workflowId, revision: workflow.revision };
        }
      } catch (error: any) {
        if (currentScope.current !== scope) return { success: false };
        const msg = error.message || 'Unknown error occurred';
        toast({
          title: 'Error',
          description: `Failed to save workflow: ${msg}`,
          variant: 'destructive',
        });
        return { success: false };
      } finally {
        saveInFlightRef.current = false;
        if (currentScope.current === scope) setSaving(false);
      }
    },
    [
      authUser,
      scope,
      hierarchySupported,
      projectId,
      toast,
      shouldBlockEmptySave,
      session?.access_token,
    ],
  );

  // ──────────────────────────────────────────────
  // LOAD
  // ──────────────────────────────────────────────
  const loadWorkflow = useCallback(
    async (
      workflowId: string,
      removeEdge: (id: string) => void,
      options: { signal?: AbortSignal; isCurrent?: () => boolean } = {},
    ): Promise<LoadedWorkflow | null> => {
      if (!authUser) return null;

      const canPublish = () => currentScope.current === scope && !options.signal?.aborted && (options.isCurrent?.() ?? true);
      if (!canPublish()) return null;
      setLoading(true);
      try {
        const response = await apiClient.request(`/workflows/${workflowId}`, { method: "GET", token: session?.access_token, signal: options.signal });
        if (!canPublish()) return null;
        if (!response.ok) {
          toast({
            title: 'Error',
            description: 'Workflow not found or access denied',
            variant: 'destructive',
          });
          return null;
        }
        const { workflow: data } = await response.json() as { workflow: Record<string, unknown> };

        // Restore nodes with definitions
        const restoredNodes = (data.nodes as unknown as (Node & { displayName?: string })[] || []).map((node) => {
          const nodeName = (node as any).name || node.id;
          const definition =
            node.data?.definition ||
            nodeManifest[nodeName as keyof typeof nodeManifest];

          const rawValues = (node as any).values || node.data?.values || {};
          const pinnedOutput = (node as { pinnedOutput?: unknown }).pinnedOutput ??
            node.data?.pinnedOutput;
          const { merged } = reconcileNodeValues(definition, rawValues, node.data?.fieldState || {});

          return {
            ...node,
            type: nodeName,
            data: {
              ...node.data,
              definition,
              values: merged,
              fieldState: merged,
              displayName: typeof node.displayName === "string" && node.displayName.trim() ? node.displayName : (typeof node.data?.displayName === "string" && node.data.displayName.trim() ? node.data.displayName : node.id),
              ...(pinnedOutput != null
                ? { pinnedOutput, output: pinnedOutput }
                : {}),
            },
          };
        });

        // Persisted endpoints and handles are canonical document data. Never
        // repair them during hydration: doing so would make a subsequent save
        // silently destroy a connection. Invalid candidates are rejected by
        // the authoritative save boundary and remain available for recovery.
        const restoredEdges = ((data.edges as unknown as Edge[]) || []).map((e) => ({
          ...e,
          type: e.type || 'removable',
          data: {
            ...(e.data || {}),
            onRemoveEdge: () => removeEdge(e.id),
          },
        }));

        const recovered = recoverClusterDocument(data.node_clusters, restoredNodes, restoredEdges);
        const result: LoadedWorkflow = {
          name: typeof data.name === 'string' ? data.name : 'Untitled Workflow',
          isActive: !!data.is_active,
          nodes: restoredNodes,
          edges: restoredEdges,
          clusters: recovered.clusters,
          invalidClusterEntries: recovered.invalidEntries,
          revision: typeof data.revision === 'number' ? data.revision : 0,
        };

        if (!canPublish()) return null;
        revisionRef.current = result.revision;
        markSaved(restoredNodes, restoredEdges, result.name, result.clusters);
        return result;
      } catch (error: any) {
        if (!canPublish()) return null;
        console.error('Error loading workflow:', error);
        toast({
          title: 'Error',
          description: 'Failed to load workflow',
          variant: 'destructive',
        });
        return null;
      } finally {
        if (canPublish()) setLoading(false);
      }
    },
    [authUser?.id, scope, session?.access_token, markSaved],
  );

  // ──────────────────────────────────────────────
  // Generate smart name for new workflows
  // ──────────────────────────────────────────────
  const generateNewWorkflowName = useCallback(
    async (forProject: boolean): Promise<string> => {
      if (!authUser) return forProject ? 'New Project Workflow' : 'My workflow 1';

      try {
        const { data: existingWorkflows, error } = await supabase
          .from('workflows')
          .select('name')
          .eq('user_id', authUser.id);

        if (!error && existingWorkflows) {
          const workflowNumbers = existingWorkflows
            .map((w) => w.name)
            .filter((name) => name.startsWith('My workflow '))
            .map((name) => {
              const match = name.match(/My workflow (\d+)/);
              return match ? parseInt(match[1]) : 0;
            })
            .filter((num) => !isNaN(num));

          const maxNumber = workflowNumbers.length > 0 ? Math.max(...workflowNumbers) : 0;
          const nextNumber = maxNumber + 1;
          return forProject
            ? `New Project Workflow ${nextNumber}`
            : `My workflow ${nextNumber}`;
        }
      } catch (error) {
        console.error('Error generating workflow name:', error);
      }

      return forProject ? 'New Project Workflow' : 'My workflow 1';
    },
    [authUser],
  );

  return {
    hierarchySupported,
    saving,
    loading,
    saveWorkflow,
    loadWorkflow,
    generateNewWorkflowName,
    hasUnsavedChanges,
    markSaved,
    checkNodeReduction,
  };
};
