import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitBranch, CheckCircle, XCircle } from "lucide-react";

interface ConditionNodeData {
  label: string;
  operator?: '>' | '<' | '=' | 'cross_above' | 'cross_below';
  threshold?: number;
  result?: boolean;
}

export const ConditionNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as ConditionNodeData;
  const operator = nodeData.operator || '>';
  const threshold = nodeData.threshold || 50;
  const result = nodeData.result ?? Math.random() > 0.5;

  const getOperatorDisplay = (op: string) => {
    switch (op) {
      case '>': return 'Greater Than';
      case '<': return 'Less Than';
      case '=': return 'Equals';
      case 'cross_above': return 'Cross Above';
      case 'cross_below': return 'Cross Below';
      default: return 'Condition';
    }
  };

  return (
    <Card className="min-w-[180px] bg-trading-node border-border shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-purple-500" />
          Condition
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">
          {getOperatorDisplay(operator)}
        </div>
        <div className="text-xs text-muted-foreground">
          Threshold: {threshold}
        </div>
        <div className="flex items-center gap-2">
          {result ? (
            <CheckCircle className="h-3 w-3 text-success" />
          ) : (
            <XCircle className="h-3 w-3 text-destructive" />
          )}
          <Badge variant={result ? "default" : "secondary"} className="text-xs">
            {result ? 'TRUE' : 'FALSE'}
          </Badge>
        </div>
      </CardContent>
      
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-muted-foreground border-2 border-background"
        id="input_a"
        style={{ top: '40%' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-muted-foreground border-2 border-background"
        id="input_b"
        style={{ top: '60%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-success border-2 border-background"
        id="true"
        style={{ top: '40%' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-destructive border-2 border-background"
        id="false"
        style={{ top: '60%' }}
      />
    </Card>
  );
});