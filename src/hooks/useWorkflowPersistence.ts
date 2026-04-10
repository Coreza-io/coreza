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

import { useState, useCallback, useRef } from 'react';
import { Node, Edge } from '@xyflow/react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkflowVersioning } from '@/hooks/useWorkflowVersioning';
import { getVisibleValues } from '@/utils/fieldVisibility';
import { nodeManifest } from '@/nodes/manifest';
import { reconcileNodeValues } from '@/utils/reconcileNodeValues';

export interface WorkflowPersistenceOptions {
  projectId: string | null;
}

export interface SaveOptions {
  skipConfirmation?: boolean;
}

export interface LoadedWorkflow {
  name: string;
  isActive: boolean;
  nodes: Node[];
  edges: Edge[];
}

/**
 * Checks if saving would cause significant node reduction (>50% from a workflow with >5 nodes).
 * Returns { shouldWarn, currentCount } so the caller can show a confirmation dialog.
 */
export interface NodeReductionCheck {
  shouldWarn: boolean;
  currentCount: number;
}

export const useWorkflowPersistence = ({ projectId }: WorkflowPersistenceOptions) => {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const { createVersionBeforeSave, shouldBlockEmptySave } = useWorkflowVersioning();

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastSavedHashRef = useRef<string>('');

  // ──────────────────────────────────────────────
  // Unsaved-change tracking via simple JSON hash
  // ──────────────────────────────────────────────
  const computeHash = useCallback(
    (nodes: Node[], edges: Edge[], name: string) =>
      JSON.stringify({ name, nodes, edges }),
    [],
  );

  const markSaved = useCallback(
    (nodes: Node[], edges: Edge[], name: string) => {
      lastSavedHashRef.current = computeHash(nodes, edges, name);
    },
    [computeHash],
  );

  const hasUnsavedChanges = useCallback(
    (nodes: Node[], edges: Edge[], name: string) =>
      lastSavedHashRef.current !== '' &&
      computeHash(nodes, edges, name) !== lastSavedHashRef.current,
    [computeHash],
  );

  // ──────────────────────────────────────────────
  // Serialise nodes for DB (strips definitions, filters hidden fields)
  // ──────────────────────────────────────────────
  const serializeNodes = useCallback((nodes: Node[]) => {
    return nodes.map((n) => ({
      id: n.id,
      name: (n.data.definition as any)?.name,
      node_type: (n.data.definition as any)?.node_type,
      category: (n.data.definition as any)?.category,
      subCategory: (n.data.definition as any)?.subCategory,
      provider: (n.data.definition as any)?.provider,
      position: n.position,
      sourcePosition: n.sourcePosition,
      targetPosition: n.targetPosition,
      values: getVisibleValues(
        n.data.definition as any,
        (n.data.values as Record<string, any>) || {},
      ),
      executionMode: (n.data.definition as any)?.executionMode,
      streamingConfig: (n.data.definition as any)?.streamingConfig,
    }));
  }, []);

  const serializeEdges = useCallback(
    (edges: Edge[], existingNodeIds: Set<string>) => {
      return edges
        .filter(
          (edge) =>
            existingNodeIds.has(edge.source) && existingNodeIds.has(edge.target),
        )
        .map((edge) => {
          const clean: any = {
            id: edge.id,
            type: edge.type,
            source: edge.source,
            target: edge.target,
          };
          if (edge.sourceHandle) clean.sourceHandle = edge.sourceHandle;
          if (edge.targetHandle) clean.targetHandle = edge.targetHandle;
          if (edge.style?.strokeLinecap || edge.style?.strokeLinejoin) {
            clean.style = {
              strokeLinecap: edge.style?.strokeLinecap || 'round',
              strokeLinejoin: edge.style?.strokeLinejoin || 'round',
            };
          }
          return clean;
        });
    },
    [],
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
    ): Promise<{ success: boolean; newId?: string }> => {
      if (!authUser) {
        toast({
          title: 'Error',
          description: 'Please log in to save workflows',
          variant: 'destructive',
        });
        return { success: false };
      }

      setSaving(true);

      try {
        // Block empty saves for existing workflows
        if (workflowId) {
          const shouldBlock = await shouldBlockEmptySave(workflowId, nodes.length);
          if (shouldBlock) {
            toast({
              title: 'Save Blocked',
              description:
                'Cannot save: This would overwrite your workflow with an empty state. If intentional, delete the workflow instead.',
              variant: 'destructive',
            });
            return { success: false };
          }

          // Create version snapshot before overwriting
          const versionCreated = await createVersionBeforeSave(workflowId);
          if (versionCreated) {
            console.log('✅ Created version backup before save');
          }
        }

        const minimalNodes = serializeNodes(nodes);
        const existingNodeIds = new Set(minimalNodes.map((n) => n.id));
        const cleanEdges = serializeEdges(edges, existingNodeIds);

        const payload = {
          user_id: authUser.id,
          name: workflowName,
          nodes: JSON.parse(JSON.stringify(minimalNodes)) as any,
          edges: JSON.parse(JSON.stringify(cleanEdges)) as any,
          updated_at: new Date().toISOString(),
          ...(projectId && { project_id: projectId }),
        };

        if (workflowId) {
          // Update existing
          const { error } = await supabase
            .from('workflows')
            .update(payload)
            .eq('id', workflowId);

          if (error) throw error;

          markSaved(nodes, edges, workflowName);
          toast({ title: 'Success', description: 'Workflow updated!' });
          return { success: true };
        } else {
          // Insert new
          const { data, error } = await supabase
            .from('workflows')
            .insert([payload])
            .select()
            .single();

          if (error) throw error;

          markSaved(nodes, edges, workflowName);
          toast({ title: 'Success', description: 'Workflow saved!' });
          return { success: true, newId: data.id };
        }
      } catch (error: any) {
        const msg = error.message || 'Unknown error occurred';
        toast({
          title: 'Error',
          description: `Failed to save workflow: ${msg}`,
          variant: 'destructive',
        });
        return { success: false };
      } finally {
        setSaving(false);
      }
    },
    [
      authUser,
      projectId,
      toast,
      serializeNodes,
      serializeEdges,
      markSaved,
      shouldBlockEmptySave,
      createVersionBeforeSave,
    ],
  );

  // ──────────────────────────────────────────────
  // LOAD
  // ──────────────────────────────────────────────
  const loadWorkflow = useCallback(
    async (
      workflowId: string,
      removeEdge: (id: string) => void,
    ): Promise<LoadedWorkflow | null> => {
      if (!authUser) return null;

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('workflows')
          .select('*')
          .eq('id', workflowId)
          .eq('user_id', authUser.id)
          .single();

        if (error || !data) {
          toast({
            title: 'Error',
            description: 'Workflow not found or access denied',
            variant: 'destructive',
          });
          return null;
        }

        // Restore nodes with definitions
        const restoredNodes = (data.nodes as unknown as Node[] || []).map((node) => {
          const nodeName = (node as any).name || node.id;
          const definition =
            node.data?.definition ||
            nodeManifest[nodeName as keyof typeof nodeManifest];

          const rawValues = (node as any).values || node.data?.values || {};
          const { merged } = reconcileNodeValues(definition, rawValues, node.data?.fieldState || {});

          return {
            ...node,
            type: nodeName,
            data: {
              ...node.data,
              definition,
              values: merged,
              fieldState: merged,
              displayName: node.id,
            },
          };
        });

        // Restore edges with edge-removal handlers & Switch validation
        const validEdges = (data.edges as unknown as Edge[] || []).filter((edge) => {
          const sourceNode = restoredNodes.find((n) => n.id === edge.source);
          if (!sourceNode || !edge.sourceHandle) return true;

          const nodeDefinition = sourceNode.data?.definition as any;
          const nodeType = nodeDefinition?.name;
          if (nodeType === 'Switch') {
            const cases =
              sourceNode.data?.values?.cases ||
              (sourceNode as any).values?.cases ||
              [];
            const validHandles = cases.map(
              (c: any) =>
                c.outputName || c.caseName || c.caseValue || `case${cases.indexOf(c) + 1}`,
            );
            const enableFallbackToggle =
              sourceNode.data?.values?.enableFallback ??
              (sourceNode as any).values?.enableFallback;
            const fallbackEnabled =
              typeof enableFallbackToggle === 'boolean'
                ? enableFallbackToggle
                : ((sourceNode.data?.definition as any)?.fields?.find(
                    (f: any) => f.key === 'enableFallback',
                  )?.default ?? true);

            if (fallbackEnabled) {
              validHandles.push(sourceNode.data?.values?.defaultCase || 'fallback');
            }

            if (!validHandles.includes(edge.sourceHandle)) {
              console.log(
                `🗑️ Removing invalid edge: ${edge.id} - handle "${edge.sourceHandle}" not found in Switch node`,
              );
              return false;
            }
          }
          return true;
        });

        const restoredEdges = validEdges.map((e) => ({
          ...e,
          type: e.type || 'removable',
          data: {
            ...(e.data || {}),
            onRemoveEdge: () => removeEdge(e.id),
          },
        }));

        const result: LoadedWorkflow = {
          name: data.name || 'Untitled Workflow',
          isActive: !!data.is_active,
          nodes: restoredNodes,
          edges: restoredEdges,
        };

        markSaved(restoredNodes, restoredEdges, result.name);
        return result;
      } catch (error: any) {
        console.error('Error loading workflow:', error);
        toast({
          title: 'Error',
          description: 'Failed to load workflow',
          variant: 'destructive',
        });
        return null;
      } finally {
        setLoading(false);
      }
    },
    [authUser, toast, markSaved],
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
    saving,
    loading,
    saveWorkflow,
    loadWorkflow,
    generateNewWorkflowName,
    hasUnsavedChanges,
    markSaved,
    checkNodeReduction,
    serializeNodes,
    serializeEdges,
  };
};
