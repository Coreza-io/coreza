import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Bot, Brain, Database, Wrench, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { BaseNodeRenderProps } from "../BaseNode";

interface AIAgentLayoutProps extends BaseNodeRenderProps {}

const AIAgentLayout: React.FC<AIAgentLayoutProps> = ({
  definition,
  displayName,
  fieldState,
  error,
  isSending,
  handleChange,
  handleSubmit,
}) => {
  return (
    <div className="relative bg-background border-2 border-primary/20 rounded-lg shadow-lg">
      {/* Main Input Handle (Left) */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="w-3 h-3 !bg-primary"
      />

      {/* Output Handle (Right) */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-3 h-3 !bg-primary"
      />

      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Bot className="w-5 h-5 text-primary" />
        <span className="font-semibold text-sm">{displayName}</span>
      </div>

      {/* Form Content */}
      <form onSubmit={handleSubmit} className="p-3 space-y-3">
        {/* System Prompt */}
        <div className="space-y-1">
          <Label htmlFor="systemPrompt" className="text-xs">
            System Prompt
          </Label>
          <Textarea
            id="systemPrompt"
            value={fieldState.systemPrompt || ""}
            onChange={(e) => handleChange("systemPrompt", e.target.value)}
            placeholder="You are a helpful AI assistant..."
            className="min-h-[60px] text-xs"
            required
          />
        </div>

        {/* User Prompt */}
        <div className="space-y-1">
          <Label htmlFor="userPrompt" className="text-xs">
            User Prompt
          </Label>
          <Textarea
            id="userPrompt"
            value={fieldState.userPrompt || ""}
            onChange={(e) => handleChange("userPrompt", e.target.value)}
            placeholder="Enter user message or use {{variable}}"
            className="min-h-[60px] text-xs"
            required
          />
        </div>

        {/* Advanced Options */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="maxIterations" className="text-xs">
              Max Iterations
            </Label>
            <Input
              id="maxIterations"
              type="number"
              value={fieldState.maxIterations || 10}
              onChange={(e) => handleChange("maxIterations", parseInt(e.target.value))}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="temperature" className="text-xs">
              Temperature
            </Label>
            <Input
              id="temperature"
              type="number"
              step="0.1"
              value={fieldState.temperature || 0.7}
              onChange={(e) => handleChange("temperature", parseFloat(e.target.value))}
              className="text-xs h-8"
            />
          </div>
        </div>

        {/* Return Intermediate Steps */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="returnIntermediateSteps"
            checked={fieldState.returnIntermediateSteps || false}
            onCheckedChange={(checked) => handleChange("returnIntermediateSteps", checked)}
          />
          <Label htmlFor="returnIntermediateSteps" className="text-xs cursor-pointer">
            Return Intermediate Steps
          </Label>
        </div>

        {/* Error Message */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" disabled={isSending} className="w-full" size="sm">
          {isSending ? "Running..." : "Execute Agent"}
        </Button>
      </form>

      {/* Bottom Handles with Labels */}
      <div className="flex justify-around items-center p-2 border-t border-border bg-muted/30">
        {/* Chat Model Handle */}
        <div className="flex flex-col items-center gap-1 relative">
          <Handle
            type="target"
            position={Position.Bottom}
            id="chatModel"
            className="!static !transform-none w-6 h-6 !bg-blue-500 border-2 border-background rounded-sm"
          >
            <Brain className="w-3 h-3 text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </Handle>
          <span className="text-[10px] text-muted-foreground font-medium">Chat Model</span>
        </div>

        {/* Memory Handle */}
        <div className="flex flex-col items-center gap-1 relative">
          <Handle
            type="target"
            position={Position.Bottom}
            id="memory"
            className="!static !transform-none w-6 h-6 !bg-purple-500 border-2 border-background rounded-sm"
          >
            <Database className="w-3 h-3 text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </Handle>
          <span className="text-[10px] text-muted-foreground font-medium">Memory</span>
        </div>

        {/* Tool Handle */}
        <div className="flex flex-col items-center gap-1 relative">
          <Handle
            type="target"
            position={Position.Bottom}
            id="tool"
            className="!static !transform-none w-6 h-6 !bg-green-500 border-2 border-background rounded-sm"
          >
            <Wrench className="w-3 h-3 text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </Handle>
          <span className="text-[10px] text-muted-foreground font-medium">Tool</span>
        </div>
      </div>
    </div>
  );
};

export default AIAgentLayout;
