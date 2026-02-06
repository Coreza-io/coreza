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

import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { X, Loader2, Activity, Radio, Clock, Target, Layers } from "lucide-react";
import {
  parseStreamName,
  getEventTypeLabel,
  getEnvironment,
} from "@/utils/streamNameParser";

interface StreamBadgeWithTooltipProps {
  stream: string;
  source: string;
  scope?: "global" | "workflow";
  workflowName?: string;
  workflowId?: string;
  onUnsubscribe?: () => void;
  isUnsubscribing?: boolean;
  className?: string;
}

export function StreamBadgeWithTooltip({
  stream,
  source,
  scope = "global",
  workflowName,
  onUnsubscribe,
  isUnsubscribing,
  className,
}: StreamBadgeWithTooltipProps) {
  const parsed = parseStreamName(source, stream);
  const environment = getEnvironment(source);
  const eventLabel = getEventTypeLabel(parsed.eventType);

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "px-2 py-1 text-sm font-mono flex items-center gap-1 group cursor-pointer",
            className,
          )}
        >
          {stream}
          {onUnsubscribe && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onUnsubscribe();
              }}
              disabled={isUnsubscribing}
              className="ml-1 opacity-50 group-hover:opacity-100 hover:text-destructive transition-opacity"
              aria-label={`Unsubscribe ${stream}`}
            >
              {isUnsubscribing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
            </button>
          )}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="w-72" side="top" align="start">
        <div className="space-y-3">
          <div className="border-b pb-2">
            <p className="font-mono font-semibold text-sm">{stream}</p>
            <p className="text-xs text-muted-foreground">Stream Details</p>
          </div>

          <div className="grid gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Symbol:</span>
              <span className="font-medium">{parsed.symbol}</span>
            </div>

            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Event Type:</span>
              <span className="font-medium">{eventLabel}</span>
            </div>

            {parsed.interval && (
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Interval:</span>
                <span className="font-medium">{parsed.interval}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Source:</span>
              <Badge variant="outline" className="text-xs py-0">
                {source}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Environment:</span>
              <span className="font-medium">{environment}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-muted-foreground ml-5">Scope:</span>
              <Badge
                variant={scope === "workflow" ? "secondary" : "default"}
                className="text-xs py-0"
              >
                {scope === "workflow" ? "Workflow-Scoped" : "Global"}
              </Badge>
            </div>

            {workflowName && (
              <div className="flex items-center gap-2 pt-1 border-t">
                <span className="text-muted-foreground ml-5">Workflow:</span>
                <span className="font-medium text-primary">
                  {workflowName}
                </span>
              </div>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
