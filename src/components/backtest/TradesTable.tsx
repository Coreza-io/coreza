import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BacktestTrade } from "@/hooks/useBacktestResults";
import { Badge } from "@/components/ui/badge";

interface TradesTableProps {
  trades: BacktestTrade[];
}

const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

const getDerivedMetrics = (trade: BacktestTrade) => {
  const entryPrice = trade.entry_price;
  const quantity = Number(trade.quantity) || 0;
  const commission = Number(trade.commission) || 0;
  const slippage = Number(trade.slippage) || 0;

  const computedNetPnl =
    entryPrice != null ? (trade.price - entryPrice) * quantity - commission - slippage : null;
  const computedReturnPct =
    entryPrice != null && entryPrice !== 0 ? ((trade.price - entryPrice) / entryPrice) * 100 : null;

  const netPnl = trade.net_pnl ?? computedNetPnl;
  const returnPct = trade.return_pct ?? computedReturnPct;
  const portfolioValueAfter =
    trade.portfolio_value_after ??
    (trade.portfolio_value_before != null && netPnl != null
      ? trade.portfolio_value_before + netPnl
      : null);

  return { netPnl, returnPct, portfolioValueAfter };
};

const getExitReasonLabel = (reason?: string) => {
  if (!reason) return null;
  const map: Record<string, string> = {
    TAKE_PROFIT: 'TAKE PROFIT',
    STOP_LOSS: 'STOP LOSS',
    SIGNAL: 'SIGNAL',
    MANUAL: 'MANUAL',
  };
  return map[reason] || reason;
};

const TradeLogRow = ({ trade }: { trade: BacktestTrade }) => {
  const isBuy = trade.action?.toLowerCase() === 'buy';
  const reasonLabel = getExitReasonLabel(trade.exit_reason);
  const { netPnl, returnPct, portfolioValueAfter } = getDerivedMetrics(trade);

  return (
    <TableRow className="text-sm">
      <TableCell className="text-muted-foreground whitespace-nowrap">
        {new Date(trade.timestamp).toLocaleString()}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Badge
            variant={isBuy ? 'secondary' : 'outline'}
            className={isBuy ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' : 'bg-red-500/15 text-red-600 border-red-500/30'}
          >
            {trade.action?.toUpperCase()}
          </Badge>
          {!isBuy && reasonLabel && (
            <span className="text-xs text-muted-foreground">({reasonLabel})</span>
          )}
        </div>
      </TableCell>
      <TableCell className="font-medium">{trade.symbol}</TableCell>
      <TableCell>
        {isBuy ? (
          <span>@ {formatCurrency(trade.price)}</span>
        ) : (
          <span>@ {formatCurrency(trade.price)}</span>
        )}
      </TableCell>
      <TableCell>{trade.quantity}</TableCell>
      <TableCell>
        {!isBuy && returnPct != null ? (
          <Badge
            variant="outline"
            className={returnPct >= 0
              ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
              : 'bg-red-500/15 text-red-600 border-red-500/30'}
          >
            {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {!isBuy && netPnl != null ? (
          <span className={netPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}>
            {netPnl >= 0 ? '+' : ''}{formatCurrency(netPnl)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {portfolioValueAfter != null ? formatCurrency(portfolioValueAfter) : '—'}
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
                <TableHead>Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Return</TableHead>
                <TableHead>Net P&L</TableHead>
                <TableHead>Portfolio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No trades yet.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => <TradeLogRow key={trade.id} trade={trade} />)
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
