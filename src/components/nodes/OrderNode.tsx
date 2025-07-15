import { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, TrendingUp, TrendingDown } from "lucide-react";

interface OrderNodeData {
  label: string;
  orderType?: 'market' | 'limit' | 'stop_loss';
  side?: 'buy' | 'sell';
  amount?: number;
  price?: number;
}

export const OrderNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as OrderNodeData;
  const orderType = nodeData.orderType || 'market';
  const side = nodeData.side || 'buy';
  const amount = nodeData.amount || 0.1;
  const price = nodeData.price || 45000;

  const getSideColor = (side: string) => {
    return side === 'buy' ? 'text-success' : 'text-destructive';
  };

  const getSideIcon = (side: string) => {
    return side === 'buy' ? TrendingUp : TrendingDown;
  };

  const getOrderTypeDisplay = (type: string) => {
    switch (type) {
      case 'market': return 'Market Order';
      case 'limit': return 'Limit Order';
      case 'stop_loss': return 'Stop Loss';
      default: return 'Order';
    }
  };

  const SideIcon = getSideIcon(side);

  return (
    <Card className="min-w-[200px] bg-trading-node border-border shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-orange-500" />
          {getOrderTypeDisplay(orderType)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <SideIcon className={`h-3 w-3 ${getSideColor(side)}`} />
          <Badge variant={side === 'buy' ? 'default' : 'destructive'} className="text-xs uppercase">
            {side}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          Amount: {amount} BTC
        </div>
        {orderType !== 'market' && (
          <div className="text-xs text-muted-foreground">
            Price: ${price.toLocaleString()}
          </div>
        )}
        <div className="text-xs font-medium text-primary">
          ~${(amount * price).toLocaleString()}
        </div>
      </CardContent>
      
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 bg-muted-foreground border-2 border-background"
        id="trigger"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="w-3 h-3 bg-primary border-2 border-background"
        id="executed"
      />
    </Card>
  );
});