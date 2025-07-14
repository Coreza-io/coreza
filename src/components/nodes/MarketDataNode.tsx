import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Wifi } from "lucide-react";

interface MarketDataNodeData {
  label: string;
  symbol?: string;
  exchange?: string;
  dataType?: 'realtime' | 'historical';
}

export const MarketDataNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as MarketDataNodeData;
  return (
    <Card className="min-w-[200px] bg-trading-node border-border shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4 text-blue-500" />
          Market Data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">
          {nodeData.symbol || 'BTC/USDT'} • {nodeData.exchange || 'Binance'}
        </div>
        <div className="flex items-center gap-2">
          <Wifi className="h-3 w-3 text-success" />
          <Badge variant="outline" className="text-xs">
            {nodeData.dataType || 'realtime'}
          </Badge>
        </div>
        <div className="text-sm font-medium text-primary">
          ${Math.random() * 50000 + 20000 | 0}
        </div>
      </CardContent>
      
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-primary border-2 border-background"
        id="price"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-primary border-2 border-background"
        id="volume"
        style={{ top: '60%' }}
      />
    </Card>
  );
});