/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { History, RotateCcw, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { Node, Edge } from '@xyflow/react';
import { Json } from '@/integrations/supabase/types';

interface WorkflowVersion {
  id: string;
  version_number: number;
  name: string;
  node_count: number;
  edge_count: number;
  created_at: string;
  change_description: string | null;
}

interface WorkflowVersionHistoryProps {
  workflowId: string | null;
  onRestore: (nodes: Node[], edges: Edge[]) => void;
  disabled?: boolean;
}

export const WorkflowVersionHistory: React.FC<WorkflowVersionHistoryProps> = ({
  workflowId,
  onRestore,
  disabled = false,
}) => {
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const fetchVersions = useCallback(async () => {
    if (!workflowId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('workflow_versions')
        .select('id, version_number, name, node_count, edge_count, created_at, change_description')
        .eq('workflow_id', workflowId)
        .order('version_number', { ascending: false })
        .limit(20);

      if (error) throw error;
      setVersions(data || []);
    } catch (error: any) {
      console.error('Failed to fetch versions:', error);
      toast({
        title: 'Error',
        description: 'Failed to load version history',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [workflowId, toast]);

  // Fetch versions count on mount and when sheet opens
  useEffect(() => {
    if (workflowId) {
      fetchVersions();
    }
  }, [workflowId]);

  // Refresh when sheet opens
  useEffect(() => {
    if (open && workflowId) {
      fetchVersions();
    }
  }, [open, workflowId, fetchVersions]);

  const handleRestore = async (version: WorkflowVersion) => {
    setRestoring(version.id);
    try {
      const { data, error } = await supabase
        .from('workflow_versions')
        .select('nodes, edges')
        .eq('id', version.id)
        .single();

      if (error) throw error;

      if (data) {
        // Convert from Json to proper types
        const nodes = (data.nodes as unknown) as Node[];
        const edges = (data.edges as unknown) as Edge[];
        
        onRestore(nodes, edges);
        setOpen(false);
        toast({
          title: 'Version Restored',
          description: `Restored to version ${version.version_number} (${version.node_count} nodes). Remember to save your workflow.`,
        });
      }
    } catch (error: any) {
      console.error('Failed to restore version:', error);
      toast({
        title: 'Error',
        description: 'Failed to restore version',
        variant: 'destructive',
      });
    } finally {
      setRestoring(null);
    }
  };

  if (!workflowId) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button 
          disabled={disabled || !workflowId} 
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 h-7 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-muted-foreground hover:text-foreground hover:bg-muted/50 gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore from Version
        </button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </SheetTitle>
        </SheetHeader>
        
        <ScrollArea className="h-[calc(100vh-120px)] mt-4 pr-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No version history yet</p>
              <p className="text-xs mt-1">Versions are created automatically when you save</p>
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs font-mono">
                          v{version.version_number}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate">{version.name}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{version.node_count} nodes</span>
                        <span>{version.edge_count} edges</span>
                      </div>
                      {version.change_description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {version.change_description}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRestore(version)}
                      disabled={restoring !== null}
                      className="shrink-0"
                    >
                      {restoring === version.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Restore
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
