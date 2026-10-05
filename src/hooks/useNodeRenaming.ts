/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNodeId } from "@xyflow/react";
import { useToast } from "@/hooks/use-toast";
import { useStableNodes } from "@/contexts/StableNodeContext";

interface UseNodeRenamingProps {
  displayName: string;
  selected: boolean;
  readOnly?: boolean;
}

interface UseNodeRenamingReturn {
  isEditing: boolean;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement>;
  startEditing: () => void;
  finishEditing: (save?: boolean) => Promise<void>;
  setEditingName: (name: string) => void;
}

/**
 * Custom hook to handle node renaming functionality
 * Supports F2 key shortcut and inline editing
 */
export function useNodeRenaming({
  displayName,
  selected,
  readOnly,
}: UseNodeRenamingProps): UseNodeRenamingReturn {
  const nodeId = useNodeId();
  const { renameNode } = useStableNodes();
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const sourceNodeIdRef = useRef<string | null>(null);
  const commitInProgressRef = useRef(false);

  // Start editing mode
  const startEditing = useCallback(() => {
    if (isEditing || readOnly || !nodeId) return;
    sourceNodeIdRef.current = nodeId;
    setEditingName(displayName);
    setIsEditing(true);
  }, [displayName, isEditing, nodeId, readOnly]);

  // Finish editing (save or cancel)
  const finishEditing = useCallback(
    async (save: boolean = true) => {
      if (commitInProgressRef.current) return;
      if (!save) {
        setIsEditing(false);
        setEditingName("");
        sourceNodeIdRef.current = null;
        return;
      }
      const sourceNodeId = sourceNodeIdRef.current ?? nodeId;
      if (!sourceNodeId) return;
      commitInProgressRef.current = true;
      try {
        const result = await renameNode({ nodeId: sourceNodeId, requestedName: editingName });
        if (!result.ok) {
          toast({ title: "Cannot rename node", description: result.message, variant: "destructive" });
          requestAnimationFrame(() => editInputRef.current?.focus());
          return;
        }
        setIsEditing(false);
        setEditingName("");
        sourceNodeIdRef.current = null;
        if (result.changed) toast({ title: "Node renamed", description: `Node renamed to "${result.newId}"` });
      } finally {
        commitInProgressRef.current = false;
      }
    },
    [editingName, nodeId, renameNode, toast]
  );

  // F2 key handler - scoped to only this node when selected
  useEffect(() => {
    if (!selected) return; // Only add listener when node is selected

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent conflicts with input fields and other editing states
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "F2" && !isEditing) {
        e.preventDefault();
        e.stopPropagation();
        startEditing();
      } else if (isEditing) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          void finishEditing(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          void finishEditing(false);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selected, isEditing, startEditing, finishEditing]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  return {
    isEditing,
    editingName,
    editInputRef,
    startEditing,
    finishEditing,
    setEditingName,
  };
}

