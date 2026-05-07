/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { X, CheckCircle2, XCircle, Clock, Copy, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { NodeExecutionLog } from "@/hooks/useExecutionHistory";
import { useToast } from "@/hooks/use-toast";

interface NodeExecutionInspectorProps {
  nodeExecution: NodeExecutionLog;
  onClose: () => void;
}

function JsonViewer({ data, label }: { data: any; label: string }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { toast } = useToast();

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast({ description: "Copied to clipboard" });
  };

  const formatValue = (value: any): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return `"${value}"`;
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  const isEmpty = data === null || data === undefined || 
    (typeof data === "object" && Object.keys(data).length === 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div 
        className="flex items-center justify-between px-3 py-2 bg-muted/50 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{label}</span>
          {!isEmpty && (
            <span className="text-xs text-muted-foreground">
              {Array.isArray(data) ? `${data.length} items` : typeof data === "object" ? `${Object.keys(data).length} keys` : ""}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            copyToClipboard();
          }}
        >
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      {isExpanded && (
        <div className="p-3 bg-background">
          {isEmpty ? (
            <span className="text-sm text-muted-foreground italic">Empty</span>
          ) : (
            <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all overflow-x-auto">
              {formatValue(data)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function NodeExecutionInspector({ nodeExecution, onClose }: NodeExecutionInspectorProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "text-xs px-2 py-0.5 rounded-full font-medium";
    switch (status) {
      case "success":
        return <span className={cn(baseClasses, "bg-success/20 text-success")}>Success</span>;
      case "failed":
        return <span className={cn(baseClasses, "bg-destructive/20 text-destructive")}>Failed</span>;
      default:
        return <span className={cn(baseClasses, "bg-muted text-muted-foreground")}>{status}</span>;
    }
  };

  return (
    <div className="w-96 border-l border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          {getStatusIcon(nodeExecution.status)}
          <span className="font-semibold text-sm truncate max-w-[200px]">
            {nodeExecution.nodeName}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Stats */}
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          {getStatusBadge(nodeExecution.status)}
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-muted-foreground">Duration</span>
          <span className="font-mono text-xs">
            {nodeExecution.durationMs < 1000 
              ? `${nodeExecution.durationMs}ms` 
              : `${(nodeExecution.durationMs / 1000).toFixed(2)}s`}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-muted-foreground">Items</span>
          <span className="font-mono text-xs">{nodeExecution.itemCount}</span>
        </div>
      </div>

      {/* Error */}
      {nodeExecution.error && (
        <div className="px-4 py-2 bg-destructive/10 border-b border-destructive/20">
          <p className="text-xs text-destructive">{nodeExecution.error}</p>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="output" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2">
          <TabsTrigger value="input" className="text-xs">Input</TabsTrigger>
          <TabsTrigger value="output" className="text-xs">Output</TabsTrigger>
        </TabsList>
        
        <TabsContent value="input" className="flex-1 overflow-hidden m-0 p-0">
          <ScrollArea className="h-full p-4">
            <JsonViewer data={nodeExecution.input} label="Input Data" />
          </ScrollArea>
        </TabsContent>
        
        <TabsContent value="output" className="flex-1 overflow-hidden m-0 p-0">
          <ScrollArea className="h-full p-4">
            <JsonViewer data={nodeExecution.output} label="Output Data" />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
