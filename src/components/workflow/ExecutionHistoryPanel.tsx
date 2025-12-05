/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  CalendarRange,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ExecutionRun } from "@/hooks/useExecutionHistory";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

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
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  dateFrom: Date | null;
  onDateFromChange: (date: Date | null) => void;
  dateTo: Date | null;
  onDateToChange: (date: Date | null) => void;
  onClearFilters: () => void;
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
  hasMore,
  loadingMore,
  onLoadMore,
  statusFilter,
  onStatusFilterChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  onClearFilters,
}: ExecutionHistoryPanelProps) {
  const [isFromOpen, setIsFromOpen] = useState(false);
  const [isToOpen, setIsToOpen] = useState(false);

  const filtersActive = useMemo(
    () => statusFilter !== "all" || !!dateFrom || !!dateTo,
    [dateFrom, dateTo, statusFilter]
  );

  const formatDateLabel = (date: Date | null) => {
    if (!date) return "Select date";
    return format(date, "MMM d, yyyy");
  };

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
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="h-4 w-4 text-muted-foreground" />
            Executions
          </div>
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

        <div className="space-y-2 text-xs">
          <div className="space-y-1.5">
            <div className="text-muted-foreground">Status</div>
            <Select
              value={statusFilter}
              onValueChange={onStatusFilterChange}
              disabled={!workflowId}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent className="text-sm">
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="success">Succeeded</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Popover open={isFromOpen} onOpenChange={setIsFromOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 justify-start"
                  disabled={!workflowId}
                >
                  <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span className="truncate">From: {formatDateLabel(dateFrom)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateFrom ?? undefined}
                  onSelect={(date) => {
                    onDateFromChange(date ?? null);
                    setIsFromOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <Popover open={isToOpen} onOpenChange={setIsToOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 justify-start"
                  disabled={!workflowId}
                >
                  <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span className="truncate">To: {formatDateLabel(dateTo)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dateTo ?? undefined}
                  onSelect={(date) => {
                    onDateToChange(date ?? null);
                    setIsToOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex items-center justify-between">
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
            {filtersActive && (
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={onClearFilters}>
                Clear
              </Button>
            )}
          </div>
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
            <>
              {executions.map((execution, index) => (
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
              ))}
              {hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Load more"
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
