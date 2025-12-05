/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { RefreshCw, Loader2, CalendarRange, Filter, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useVirtualizer } from "@tanstack/react-virtual";

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
  error?: string | null;
  onRetry?: () => void;
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
  error,
  onRetry,
}: ExecutionHistoryPanelProps) {
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isFromOpen, setIsFromOpen] = useState(false);
  const [isToOpen, setIsToOpen] = useState(false);
  const listParentRef = useRef<HTMLDivElement | null>(null);

  const filtersActive = useMemo(
    () => statusFilter !== "all" || !!dateFrom || !!dateTo,
    [dateFrom, dateTo, statusFilter]
  );

  const shouldVirtualize = executions.length > 50;
  const rowVirtualizer = useVirtualizer({
    count: executions.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 72,
    overscan: 6,
  });

  const formatDateLabel = (date: Date | null) => {
    if (!date) return "Select date";
    return format(date, "MMM d, yyyy");
  };

  const getStatusAccent = (status: string) => {
    switch (status) {
      case "success":
        return "border-l-success";
      case "failed":
        return "border-l-destructive";
      case "running":
        return "border-l-warning";
      default:
        return "border-l-muted";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "success":
        return "Succeeded";
      case "failed":
        return "Failed";
      case "running":
        return "Running";
      case "pending":
        return "Pending";
      default:
        return status;
    }
  };

  const renderExecutionRow = (execution: ExecutionRun) => (
    <button
      key={execution.id}
      onClick={() => onSelectExecution(execution)}
      className={cn(
        "w-full text-left p-3 mb-1 transition-colors border-l-4",
        "hover:bg-muted/50",
        getStatusAccent(execution.status),
        selectedExecution?.id === execution.id && "bg-muted"
      )}
      aria-label={`Execution from ${format(new Date(execution.started_at), "MMM d, HH:mm:ss")}`}
    >
      <div className="text-sm font-medium">
        {format(new Date(execution.started_at), "MMM d, HH:mm:ss")}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {getStatusLabel(execution.status)} in {getDuration(execution)}
      </div>
    </button>
  );

  return (
    <div className="w-72 border-r border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Executions</div>
            <div className="text-xs text-muted-foreground">No active executions</div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={onRefresh}
              disabled={!workflowId || loading}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            <Popover open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-8 w-8"
                  disabled={!workflowId}
                >
                  <Filter className="h-4 w-4" />
                  {filtersActive && <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-primary rounded-full" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end" sideOffset={8}>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Status</div>
                    <Select
                      value={statusFilter}
                      onValueChange={onStatusFilterChange}
                      disabled={!workflowId}
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Any status" />
                      </SelectTrigger>
                      <SelectContent className="text-sm">
                        <SelectItem value="all">Any status</SelectItem>
                        <SelectItem value="success">Succeeded</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                        <SelectItem value="running">Running</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Execution start</div>
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
                            <span className="truncate">Earliest: {formatDateLabel(dateFrom)}</span>
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
                            <span className="truncate">Latest: {formatDateLabel(dateTo)}</span>
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
                  </div>

                  {filtersActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        onClearFilters();
                        setIsFiltersOpen(false);
                      }}
                    >
                      Reset filters
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="auto-refresh"
            checked={autoRefresh}
            onCheckedChange={(checked) => onAutoRefreshChange(!!checked)}
          />
          <label htmlFor="auto-refresh" className="text-sm text-muted-foreground cursor-pointer">
            Auto refresh
          </label>
        </div>
      </div>

      {/* Execution List */}
      <div
        ref={listParentRef}
        className="flex-1 overflow-y-auto"
        tabIndex={0}
        aria-label="Execution history list"
        aria-busy={loading}
      >
        <div className="p-2 space-y-2">
          {loading && executions.length === 0 ? (
            <div className="space-y-2" aria-live="polite">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Failed to load executions</AlertTitle>
              <AlertDescription className="flex items-center gap-2">
                <span className="text-xs">{error}</span>
                {onRetry && (
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          ) : executions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No executions yet
            </div>
          ) : (
            <>
              {shouldVirtualize ? (
                <div
                  className="relative"
                  style={{ height: rowVirtualizer.getTotalSize() }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const execution = executions[virtualRow.index];
                    return (
                      <div
                        key={execution.id}
                        className="absolute top-0 left-0 w-full"
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        {renderExecutionRow(execution)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                executions.map((execution) => renderExecutionRow(execution))
              )}
              {hasMore && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  aria-label="Load more executions"
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
      </div>
    </div>
  );
}
