import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Save, Play, Pause, Loader2, Zap, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface WorkflowHeaderProps {
  workflowName: string;
  onWorkflowNameChange: (name: string) => void;
  isActive: boolean;
  onActivate: () => void;
  onSave: () => void;
  onExecute: () => void;
  onStopExecution: () => void;
  loading: boolean;
  saving: boolean;
  isExecuting: boolean;
  hasUnsavedChanges: boolean;
  nodeCount: number;
  disabled?: boolean;
}

export const WorkflowHeader: React.FC<WorkflowHeaderProps> = ({
  workflowName,
  onWorkflowNameChange,
  isActive,
  onActivate,
  onSave,
  onExecute,
  onStopExecution,
  loading,
  saving,
  isExecuting,
  hasUnsavedChanges,
  nodeCount,
  disabled = false,
}) => {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <Input
            value={workflowName}
            onChange={(e) => onWorkflowNameChange(e.target.value)}
            className="text-xl font-bold bg-transparent border-none p-0 h-auto focus-visible:ring-0 hover:bg-muted/30 rounded px-2 py-1 transition-colors"
            placeholder="Workflow name"
            disabled={disabled}
          />
          <div className="flex items-center gap-2 px-2">
            <Badge 
              variant={isActive ? "default" : "secondary"}
              className="text-xs font-medium"
            >
              {isActive ? "Active" : "Draft"}
            </Badge>
            
            <AnimatePresence mode="wait">
              {saving && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </motion.div>
              )}
              
              {!saving && hasUnsavedChanges && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="text-xs text-warning"
                >
                  Unsaved changes
                </motion.span>
              )}
              
              {!saving && !hasUnsavedChanges && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="text-xs text-muted-foreground"
                >
                  All changes saved
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <Button
          onClick={onSave}
          disabled={loading || saving || disabled}
          variant="outline"
          className="h-10 px-4 font-medium hover:bg-muted/50 transition-colors"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save
            </>
          )}
        </Button>
        
        {!isExecuting ? (
          <Button
            onClick={onExecute}
            disabled={loading || isExecuting || nodeCount === 0 || disabled}
            variant="secondary"
            className="h-10 px-4 font-medium bg-primary/10 hover:bg-primary/20 text-primary border-primary/20 transition-all duration-200"
          >
            <Zap className="h-4 w-4 mr-2" />
            Execute All
          </Button>
        ) : (
          <Button
            onClick={onStopExecution}
            disabled={disabled}
            variant="destructive"
            className="h-10 px-4 font-medium transition-all duration-200"
          >
            <Square className="h-4 w-4 mr-2" />
            Stop
          </Button>
        )}
        
        <Button
          onClick={onActivate}
          disabled={loading || disabled}
          className="h-10 px-6 font-medium bg-success hover:bg-success/90 text-success-foreground shadow-sm transition-all duration-200"
        >
          <Play className="h-4 w-4 mr-2" />
          {isActive ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
  );
};