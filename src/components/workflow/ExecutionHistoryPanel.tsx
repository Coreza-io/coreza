/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useId, useRef, useState } from "react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import {
  RefreshCw,
  Loader2,
  CalendarRange,
  Filter,
  AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ExecutionStatus, ExecutionSummary } from "@/hooks/useExecutionHistory";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useVirtualizer } from "@tanstack/react-virtual";

interface BarHistoryFilters {
  symbol: string;
  from: string;
  to: string;
  fromTime: string;
  toTime: string;
}

export interface ExecutionHistoryFilterValues {
  status: ExecutionStatus;
  dateFrom: Date | null;
  dateTo: Date | null;
  bars: BarHistoryFilters;
}

export const EMPTY_EXECUTION_HISTORY_FILTERS: ExecutionHistoryFilterValues = {
  status: "all",
  dateFrom: null,
  dateTo: null,
  bars: { symbol: "", from: "", to: "", fromTime: "", toTime: "" },
};

const hasFilters = ({ status, dateFrom, dateTo, bars }: ExecutionHistoryFilterValues) =>
  status !== "all" || Boolean(dateFrom || dateTo || bars.symbol.trim() || bars.from || bars.to);

interface ExecutionHistoryPanelProps {
  workflowId: string | null;
  selectedExecution: ExecutionSummary | null;
  selectedExecutionId?: string | null;
  onSelectExecution: (execution: ExecutionSummary) => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  onRefresh: () => void;
  executions: ExecutionSummary[];
  loading: boolean;
  getDuration: (execution: ExecutionSummary) => string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  filters: ExecutionHistoryFilterValues;
  onApplyFilters: (filters: ExecutionHistoryFilterValues) => void;
  timezone: string;
  error?: string | null;
  onRetry?: () => void;
}

export function ExecutionHistoryPanel({
  workflowId,
  selectedExecution,
  selectedExecutionId,
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
  filters,
  onApplyFilters,
  timezone,
  error,
  onRetry,
}: ExecutionHistoryPanelProps) {
  const filtersFormId = useId();
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [isFromOpen, setIsFromOpen] = useState(false);
  const [isToOpen, setIsToOpen] = useState(false);
  const listParentRef = useRef<HTMLDivElement | null>(null);

  const filtersActive = hasFilters(filters);
  const { dateFrom, dateTo, bars } = draft;

  const applyFilters = (values: ExecutionHistoryFilterValues) => {
    onApplyFilters(values);
    setIsFiltersOpen(false);
  };

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
      case "cancelled":
        return "border-l-muted-foreground";
      case "queued":
      case "pending":
        return "border-l-muted";
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
      case "queued":
        return "Queued";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  };

  const renderExecutionRow = (execution: ExecutionSummary) => {
    const title = execution.bar_time
      ? `${execution.bar_symbol} · ${formatInTimeZone(execution.bar_time, timezone, "MMM d, yyyy HH:mm:ss zzz")}`
      : format(new Date(execution.started_at), "MMM d, HH:mm:ss");
    return (
      <button
        key={execution.id}
        onClick={() => onSelectExecution(execution)}
        className={cn(
          "w-full text-left p-3 mb-1 transition-colors border-l-4",
          "hover:bg-muted/50",
          getStatusAccent(execution.status),
          (selectedExecutionId ?? selectedExecution?.id) === execution.id && "bg-muted",
        )}
        aria-label={execution.bar_time ? `Backtest bar ${title}` : `Execution from ${title}`}
      >
        <div className="text-sm font-medium">
          {title}
        </div>
        <div
          className="text-xs text-muted-foreground mt-1"
          title="Elapsed start-to-finish workflow time. The selected run shows recorded node time separately."
        >
          {getStatusLabel(execution.status)} · Elapsed: {getDuration(execution)}
        </div>
      </button>
    );
  };

  return (
    <div className="w-72 border-r border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Executions</div>
            <div className="text-xs text-muted-foreground">
              No active executions
            </div>
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
            <Popover open={isFiltersOpen} onOpenChange={(open) => {
              if (open) {
                setDraft(filters);
                setIsFromOpen(false);
                setIsToOpen(false);
              }
              setIsFiltersOpen(open);
            }}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-8 w-8"
                  disabled={!workflowId}
                >
                  <Filter className="h-4 w-4" />
                  {filtersActive && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-primary rounded-full" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[var(--radix-popover-content-available-width)] flex-col"
                align="end"
                sideOffset={8}
                collisionPadding={8}
              >
                <form
                  id={filtersFormId}
                  className="min-h-0 space-y-4 overflow-y-auto p-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyFilters(draft);
                  }}
                >
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Status</div>
                    <Select
                      value={draft.status}
                      onValueChange={(status) => setDraft({ ...draft, status: status as ExecutionStatus })}
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
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium">Execution start</div>
                    <div className="flex flex-col gap-2">
                      <Popover open={isFromOpen} onOpenChange={setIsFromOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-w-0 justify-start"
                            disabled={!workflowId}
                          >
                            <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
                            <span className="truncate">
                              Earliest: {formatDateLabel(dateFrom)}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={dateFrom ?? undefined}
                            onSelect={(date) => {
                              setDraft({ ...draft, dateFrom: date ?? null });
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
                            className="min-w-0 justify-start"
                            disabled={!workflowId}
                          >
                            <CalendarRange className="h-4 w-4 mr-2 text-muted-foreground" />
                            <span className="truncate">
                              Latest: {formatDateLabel(dateTo)}
                            </span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={dateTo ?? undefined}
                            onSelect={(date) => {
                              setDraft({ ...draft, dateTo: date ?? null });
                              setIsToOpen(false);
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <fieldset className="min-w-0 space-y-2">
                    <legend className="text-sm font-medium">Historical bars ({timezone})</legend>
                    <label className="block text-xs">
                      Symbol
                      <Input
                        value={bars.symbol}
                        onChange={(event) => setDraft({ ...draft, bars: { ...bars, symbol: event.target.value } })}
                        placeholder="e.g. AAPL"
                      />
                    </label>
                    {(["from", "to"] as const).map((bound) => {
                      const label = bound === "from" ? "From" : "To";
                      const timeKey = bound === "from" ? "fromTime" : "toTime";
                      return (
                        <div key={bound} className="flex flex-wrap gap-2">
                          <label className="min-w-0 grow basis-32 text-xs">
                            {label} date
                            <Input
                              type="date"
                              className="px-2"
                              value={bars[bound]}
                              onChange={(event) => {
                                const date = event.target.value;
                                setDraft({ ...draft, bars: { ...bars, [bound]: date, [timeKey]: date ? bars[timeKey] : "" } });
                              }}
                            />
                          </label>
                          <label className="min-w-0 grow basis-32 text-xs">
                            {label} time (optional)
                            <Input
                              type="time"
                              className="px-2"
                              step={1}
                              value={bars[timeKey]}
                              disabled={!bars[bound]}
                              onChange={(event) => setDraft({ ...draft, bars: { ...bars, [timeKey]: event.target.value } })}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </fieldset>
                </form>
                <div className="flex shrink-0 justify-end gap-2 pt-4">
                  {(filtersActive || hasFilters(draft)) && (
                    <Button variant="outline" size="sm" onClick={() => applyFilters(EMPTY_EXECUTION_HISTORY_FILTERS)}>
                      Reset filters
                    </Button>
                  )}
                  <Button size="sm" type="submit" form={filtersFormId}>
                    Apply filters
                  </Button>
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
          <label
            htmlFor="auto-refresh"
            className="text-sm text-muted-foreground cursor-pointer"
          >
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
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
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
