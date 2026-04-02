import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BacktestTrade, TradeOrder } from "@/hooks/useBacktestResults";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

interface TradesTableProps {
  trades: BacktestTrade[];
}

const formatCurrency = (value?: number | null) =>
  value == null ? "—" : `$${value.toFixed(2)}`;

const formatTime = (time?: string | null) =>
  time ? new Date(time).toLocaleString() : "—";

const OrderSubRow = ({ order }: { order: TradeOrder }) => (
  <TableRow className="bg-muted/30 text-xs">
    <TableCell />
    <TableCell className="text-muted-foreground whitespace-nowrap">
      {formatTime(order.time)}
    </TableCell>
    <TableCell>{order.symbol}</TableCell>
    <TableCell colSpan={2}>
      <span className="font-medium">
        {order.side?.charAt(0).toUpperCase() + order.side?.slice(1)}{" "}
        {order.orderType ?? "Market"} Fill
      </span>
      {order.exitReason && (
        <span className="ml-1.5 text-muted-foreground">
          ({order.exitReason})
        </span>
      )}
    </TableCell>
    <TableCell>{formatCurrency(order.fillPrice)}</TableCell>
    <TableCell>{order.quantity}</TableCell>
    <TableCell>
      <Badge
        variant="outline"
        className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs"
      >
        {order.status ?? "Filled"}
      </Badge>
    </TableCell>
    <TableCell />
    <TableCell />
  </TableRow>
);

const TradeRow = ({
  trade,
  isExpanded,
  onToggle,
}: {
  trade: BacktestTrade;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const hasOrders = trade.orders && trade.orders.length > 0;
  const isBuy = trade.action?.toLowerCase() === "buy";

  return (
    <>
      <TableRow
        className={`text-sm ${hasOrders ? "cursor-pointer hover:bg-muted/50" : ""}`}
        onClick={hasOrders ? onToggle : undefined}
      >
        <TableCell className="w-8 px-2">
          {hasOrders &&
            (isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            ))}
        </TableCell>
        <TableCell className="text-muted-foreground whitespace-nowrap">
          {formatTime(trade.entryTime)}
        </TableCell>
        <TableCell className="font-medium">{trade.symbol}</TableCell>
        <TableCell className="text-muted-foreground whitespace-nowrap">
          {formatTime(trade.exitTime)}
        </TableCell>
        <TableCell>
          <Badge
            variant={isBuy ? "secondary" : "outline"}
            className={
              isBuy
                ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                : "bg-red-500/15 text-red-600 border-red-500/30"
            }
          >
            {trade.action?.toUpperCase()}
          </Badge>
        </TableCell>
        <TableCell>{formatCurrency(trade.entryPrice)}</TableCell>
        <TableCell>{formatCurrency(trade.exitPrice)}</TableCell>
        <TableCell>{trade.quantity}</TableCell>
        <TableCell>
          {trade.net_pnl != null ? (
            <span
              className={
                trade.net_pnl >= 0 ? "text-emerald-600" : "text-red-600"
              }
            >
              {trade.net_pnl >= 0 ? "+" : ""}
              {formatCurrency(trade.net_pnl)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {formatCurrency(trade.fees ?? trade.commission)}
        </TableCell>
        <TableCell>
          {trade.result ? (
            <Badge
              variant="outline"
              className={
                trade.result === "Win"
                  ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                  : "bg-red-500/15 text-red-600 border-red-500/30"
              }
            >
              {trade.result}
            </Badge>
          ) : trade.net_pnl != null ? (
            <Badge
              variant="outline"
              className={
                trade.net_pnl >= 0
                  ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                  : "bg-red-500/15 text-red-600 border-red-500/30"
              }
            >
              {trade.net_pnl >= 0 ? "Win" : "Loss"}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>
      {isExpanded &&
        trade.orders?.map((order) => (
          <OrderSubRow key={order.id} order={order} />
        ))}
    </>
  );
};

export const TradesTable = ({ trades }: TradesTableProps) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trade Log</CardTitle>
          <Badge variant="outline">{trades.length} trades</Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div className="min-w-[900px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Entry Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Exit Time</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Entry Price</TableHead>
                <TableHead>Exit Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>P&L</TableHead>
                <TableHead>Fees</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={11}
                    className="text-center text-muted-foreground"
                  >
                    No trades yet.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TradeRow
                    key={trade.id}
                    trade={trade}
                    isExpanded={expandedIds.has(trade.id)}
                    onToggle={() => toggleExpand(trade.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
