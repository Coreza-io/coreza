/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { format } from "date-fns";
import { RefreshCw, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ExecutionRun, useExecutionHistory } from "@/hooks/useExecutionHistory";

interface ExecutionHistoryPanelProps {
  workflowId: string | null;
  selectedExecution: ExecutionRun | null;
  onSelectExecution: (execution: ExecutionRun) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  onRefresh: () => void;
  executions: ExecutionRun[];
  loading: boolean;
  getDuration: (execution: ExecutionRun) => string;
}

export function ExecutionHistoryPanel({
  workflowId,
  selectedExecution,
  onSelectExecution,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
  executions,
  loading,
  getDuration,
}: ExecutionHistoryPanelProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "running":
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "text-xs px-2 py-0.5 rounded-full font-medium";
    switch (status) {
      case "success":
        return <span className={cn(baseClasses, "bg-success/20 text-success")}>Succeeded</span>;
      case "failed":
        return <span className={cn(baseClasses, "bg-destructive/20 text-destructive")}>Failed</span>;
      case "running":
        return <span className={cn(baseClasses, "bg-primary/20 text-primary")}>Running</span>;
      default:
        return <span className={cn(baseClasses, "bg-muted text-muted-foreground")}>{status}</span>;
    }
  };

  return (
    <div className="w-72 border-r border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Executions</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="auto-refresh"
            checked={autoRefresh}
            onCheckedChange={(checked) => onAutoRefreshChange(!!checked)}
          />
          <label htmlFor="auto-refresh" className="text-xs text-muted-foreground cursor-pointer">
            Auto refresh
          </label>
        </div>
      </div>

      {/* Execution List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {executions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No executions yet
            </div>
          ) : (
            executions.map((execution, index) => (
              <button
                key={execution.id}
                onClick={() => onSelectExecution(execution)}
                className={cn(
                  "w-full text-left p-3 rounded-lg mb-1 transition-colors",
                  "hover:bg-muted/50",
                  selectedExecution?.id === execution.id && "bg-muted"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(execution.status)}
                    <span className="text-xs text-muted-foreground">
                      #{executions.length - index}
                    </span>
                  </div>
                  {getStatusBadge(execution.status)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {format(new Date(execution.started_at), "MMM d, HH:mm:ss")}
                </div>
                <div className="text-xs text-muted-foreground">
                  Duration: {getDuration(execution)}
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
