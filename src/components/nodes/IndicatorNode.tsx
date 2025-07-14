import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, BarChart3 } from "lucide-react";

interface IndicatorNodeData {
  label: string;
  indicator?: 'SMA' | 'RSI' | 'MACD' | 'BB';
  period?: number;
  value?: number;
}

export const IndicatorNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as IndicatorNodeData;
  const getIndicatorColor = (indicator: string) => {
    switch (indicator) {
      case 'SMA': return 'text-blue-500';
      case 'RSI': return 'text-purple-500';
      case 'MACD': return 'text-orange-500';
      case 'BB': return 'text-green-500';
      default: return 'text-gray-500';
    }
  };

  const getRandomValue = (indicator: string) => {
    switch (indicator) {
      case 'RSI': return Math.random() * 100;
      case 'SMA': return Math.random() * 50000 + 20000;
      case 'MACD': return (Math.random() - 0.5) * 1000;
      default: return Math.random() * 100;
    }
  };

  const indicator = nodeData.indicator || 'SMA';
  const value = nodeData.value || getRandomValue(indicator);

  return (
    <Card className="min-w-[180px] bg-trading-node border-border shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className={`h-4 w-4 ${getIndicatorColor(indicator)}`} />
          {indicator}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">
          Period: {nodeData.period || 14}
        </div>
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3 w-3 text-muted-foreground" />
          <Badge variant="outline" className="text-xs">
            Technical
          </Badge>
        </div>
        <div className="text-sm font-medium text-primary">
          {indicator === 'RSI' ? value.toFixed(1) : 
           indicator === 'SMA' ? `$${value.toFixed(0)}` :
           value.toFixed(2)}
        </div>
      </CardContent>
      
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-muted-foreground border-2 border-background"
        id="input"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-primary border-2 border-background"
        id="output"
      />
    </Card>
  );
});