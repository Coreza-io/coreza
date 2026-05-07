/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const MAX_VERSIONS_TO_KEEP = 20;

export const useWorkflowVersioning = () => {
  const { user: authUser } = useAuth();

  /**
   * Creates a version snapshot of the current workflow state before saving changes.
   * This should be called BEFORE updating the main workflow record.
   */
  const createVersionBeforeSave = useCallback(
    async (workflowId: string): Promise<boolean> => {
      if (!workflowId || !authUser) return false;

      try {
        // Fetch current state from DB before it gets overwritten
        const { data: current, error: fetchError } = await supabase
          .from("workflows")
          .select("name, nodes, edges, is_active")
          .eq("id", workflowId)
          .single();

        if (fetchError || !current) {
          console.warn(
            "Could not fetch current workflow for versioning:",
            fetchError
          );
          return false;
        }

        const nodes = current.nodes as any[];
        const edges = current.edges as any[];

        // Don't create version if current state is empty
        if (!nodes || nodes.length === 0) {
          console.log("Skipping version creation: current state is empty");
          return false;
        }

        // Get next version number
        const { data: lastVersion } = await supabase
          .from("workflow_versions")
          .select("version_number")
          .eq("workflow_id", workflowId)
          .order("version_number", { ascending: false })
          .limit(1)
          .single();

        const nextVersion = (lastVersion?.version_number || 0) + 1;

        // Insert new version
        const { error: insertError } = await supabase
          .from("workflow_versions")
          .insert({
            workflow_id: workflowId,
            version_number: nextVersion,
            name: current.name,
            nodes: current.nodes,
            edges: current.edges,
            is_active: current.is_active,
            node_count: nodes.length,
            edge_count: Array.isArray(edges) ? edges.length : 0,
            created_by: authUser.id,
          });

        if (insertError) {
          console.error("Failed to create workflow version:", insertError);
          return false;
        }

        // Cleanup old versions (keep only the last MAX_VERSIONS_TO_KEEP)
        await cleanupOldVersions(workflowId);

        console.log(
          `Created workflow version ${nextVersion} with ${nodes.length} nodes`
        );
        return true;
      } catch (error) {
        console.error("Error creating workflow version:", error);
        return false;
      }
    },
    [authUser]
  );

  /**
   * Removes old versions to keep storage clean.
   * Keeps only the last MAX_VERSIONS_TO_KEEP versions.
   */
  const cleanupOldVersions = async (workflowId: string): Promise<void> => {
    try {
      // Get all versions ordered by version_number descending
      const { data: versions, error } = await supabase
        .from("workflow_versions")
        .select("id, version_number")
        .eq("workflow_id", workflowId)
        .order("version_number", { ascending: false });

      if (error || !versions) return;

      // If we have more than MAX_VERSIONS_TO_KEEP, delete the oldest ones
      if (versions.length > MAX_VERSIONS_TO_KEEP) {
        const versionsToDelete = versions.slice(MAX_VERSIONS_TO_KEEP);
        const idsToDelete = versionsToDelete.map((v) => v.id);

        await supabase.from("workflow_versions").delete().in("id", idsToDelete);

        console.log(`Cleaned up ${idsToDelete.length} old workflow versions`);
      }
    } catch (error) {
      console.error("Error cleaning up old versions:", error);
    }
  };

  /**
   * Checks if saving would result in data loss (going from nodes to empty).
   * Returns true if the save should be blocked.
   */
  const shouldBlockEmptySave = useCallback(
    async (workflowId: string, newNodeCount: number): Promise<boolean> => {
      if (!workflowId) return false;

      try {
        const { data: current } = await supabase
          .from("workflows")
          .select("nodes")
          .eq("id", workflowId)
          .single();

        if (!current) return false;

        const currentNodes = current.nodes as any[];
        const currentNodeCount = Array.isArray(currentNodes)
          ? currentNodes.length
          : 0;

        // Block if going from ANY workflow with nodes to completely empty
        if (currentNodeCount > 0 && newNodeCount === 0) {
          console.warn(
            `🚫 Blocked complete data loss: ${currentNodeCount} nodes → 0 nodes`
          );
          return true;
        }

        // Log warning for significant reduction (but don't block)
        if (currentNodeCount > 5 && newNodeCount < currentNodeCount * 0.5) {
          console.warn(
            `⚠️ Warning: significant node reduction from ${currentNodeCount} to ${newNodeCount}`
          );
        }

        return false;
      } catch (error) {
        console.error("Error checking for empty save:", error);
        return false;
      }
    },
    []
  );

  return {
    createVersionBeforeSave,
    shouldBlockEmptySave,
  };
};
