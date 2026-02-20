import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BacktestTrade } from "@/hooks/useBacktestResults";
import { Badge } from "@/components/ui/badge";

interface TradesTableProps {
  trades: BacktestTrade[];
}

const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

const getExitReasonLabel = (reason?: string) => {
  if (!reason) return null;
  const map: Record<string, string> = {
    TAKE_PROFIT: "TAKE PROFIT",
    STOP_LOSS: "STOP LOSS",
    SIGNAL: "SIGNAL",
    MANUAL: "MANUAL",
  };
  return map[reason] || reason;
};

const TradeLogRow = ({ trade }: { trade: BacktestTrade }) => {
  const isBuy = trade.action?.toLowerCase() === "buy";
  const reasonLabel = getExitReasonLabel(trade.exit_reason);

  return (
    <TableRow className="text-sm">
      <TableCell className="text-muted-foreground whitespace-nowrap">
        {new Date(trade.timestamp).toLocaleString()}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
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
          {isBuy && reasonLabel && (
            <span className="text-xs text-muted-foreground">
              ({reasonLabel})
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-medium">{trade.symbol}</TableCell>
      <TableCell>
        {isBuy ? (
          <span>@ {formatCurrency(trade.entry_price)}</span>
        ) : (
          <span>@ {formatCurrency(trade.entry_price)}</span>
        )}
      </TableCell>
      <TableCell>
        {isBuy ? (
          <span>@ {formatCurrency(trade.price)}</span>
        ) : (
          <span>@ {formatCurrency(trade.price)}</span>
        )}
      </TableCell>
      <TableCell>{trade.quantity}</TableCell>
      <TableCell>
        {isBuy && trade.return_pct != null ? (
          <Badge
            variant="outline"
            className={
              trade.return_pct >= 0
                ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
                : "bg-red-500/15 text-red-600 border-red-500/30"
            }
          >
            {trade.return_pct >= 0 ? "+" : ""}
            {trade.return_pct.toFixed(2)}%
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {isBuy && trade.net_pnl != null ? (
          <span
            className={trade.net_pnl >= 0 ? "text-emerald-600" : "text-red-600"}
          >
            {trade.net_pnl >= 0 ? "+" : ""}
            {formatCurrency(trade.net_pnl)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {trade.portfolio_value_after
          ? formatCurrency(trade.portfolio_value_after)
          : "—"}
      </TableCell>
    </TableRow>
  );
};

export const TradesTable = ({ trades }: TradesTableProps) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trade Log</CardTitle>
          <Badge variant="outline">{trades.length} entries</Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div className="min-w-[800px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Entry Price</TableHead>
                <TableHead>Exit Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Return</TableHead>
                <TableHead>Net P&L</TableHead>
                <TableHead>Portfolio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground"
                  >
                    No trades yet.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => (
                  <TradeLogRow key={trade.id} trade={trade} />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
