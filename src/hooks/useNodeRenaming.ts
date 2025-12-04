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

import { useState, useEffect, useCallback, useRef } from "react";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import { useToast } from "@/hooks/use-toast";

interface UseNodeRenamingProps {
  displayName: string;
  selected: boolean;
}

interface UseNodeRenamingReturn {
  isEditing: boolean;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement>;
  startEditing: () => void;
  finishEditing: (save?: boolean) => void;
  setEditingName: (name: string) => void;
}

/**
 * Custom hook to handle node renaming functionality
 * Supports F2 key shortcut and inline editing
 */
export function useNodeRenaming({
  displayName,
  selected,
}: UseNodeRenamingProps): UseNodeRenamingReturn {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const { setNodes, setEdges } = useReactFlow();
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Start editing mode
  const startEditing = useCallback(() => {
    if (isEditing) return; // Prevent double activation
    setEditingName(displayName);
    setIsEditing(true);
  }, [displayName, isEditing]);

  // Finish editing (save or cancel)
  const finishEditing = useCallback(
    (save: boolean = true) => {
      if (save && editingName.trim() && editingName.trim() !== displayName) {
        const trimmedName = editingName.trim();

        // Validation: Check for invalid characters and length
        if (trimmedName.length > 50) {
          toast({
            title: "Name too long",
            description: "Node name must be 50 characters or less",
            variant: "destructive",
          });
          return;
        }

        if (!/^[a-zA-Z0-9_\-\s]+$/.test(trimmedName)) {
          toast({
            title: "Invalid characters",
            description:
              "Node name can only contain letters, numbers, spaces, hyphens, and underscores",
            variant: "destructive",
          });
          return;
        }

        // Check for name uniqueness across all nodes (both IDs and displayNames)
        const existingNames = nodes
          .filter((n) => n.id !== nodeId)
          .map((n) => n.data?.displayName || n.id)
          .filter((name): name is string => typeof name === "string")
          .map((name) => name.toLowerCase());

        let finalName = trimmedName;
        if (existingNames.includes(finalName.toLowerCase())) {
          let counter = 1;
          while (
            existingNames.includes(`${finalName}${counter}`.toLowerCase())
          ) {
            counter++;
          }
          finalName = `${finalName}${counter}`;
        }

        const oldNodeId = nodeId!;
        const newNodeId = finalName;

        // Update node with new ID and display name (N8N behavior)
        setNodes((prevNodes) => {
          return prevNodes.map((node) => {
            if (node.id === oldNodeId) {
              return {
                ...node,
                id: newNodeId,
                data: {
                  ...node.data,
                  displayName: finalName,
                },
              };
            }
            return node;
          });
        });

        // Update all edges that reference the old node ID
        setEdges((prevEdges) => {
          return prevEdges.map((edge) => {
            const updatedEdge = { ...edge };
            if (edge.source === oldNodeId) {
              updatedEdge.source = newNodeId;
            }
            if (edge.target === oldNodeId) {
              updatedEdge.target = newNodeId;
            }
            // Update edge ID if it contains the old node ID
            if (edge.id.includes(oldNodeId)) {
              updatedEdge.id = edge.id.replace(oldNodeId, newNodeId);
            }
            return updatedEdge;
          });
        });

        toast({
          title: "Node renamed",
          description: `Node renamed to "${finalName}"`,
        });
      }

      setIsEditing(false);
      setEditingName("");
    },
    [editingName, displayName, nodeId, nodes, setNodes, setEdges, toast]
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
          finishEditing(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finishEditing(false);
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

