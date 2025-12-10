import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BacktestTrade } from "@/hooks/useBacktestResults";
import { Badge } from "@/components/ui/badge";

interface TradesTableProps {
  trades: BacktestTrade[];
}

const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

export const TradesTable = ({ trades }: TradesTableProps) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Trades</CardTitle>
          <Badge variant="outline">{trades.length} trades</Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div className="min-w-[800px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Gross P&amp;L</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Net P&amp;L</TableHead>
                <TableHead>Entry Time</TableHead>
                <TableHead>Exit Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    No trades yet.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => {
                  const netPl = trade.net_pl ?? trade.gross_pl - (trade.commission || 0);
                  const isProfit = netPl >= 0;
                  return (
                    <TableRow key={trade.id} className="text-sm">
                      <TableCell className="font-medium">{trade.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={trade.side?.toLowerCase() === 'buy' ? 'secondary' : 'outline'}>{trade.side}</Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(trade.entry_price)}</TableCell>
                      <TableCell>{formatCurrency(trade.exit_price)}</TableCell>
                      <TableCell>{trade.quantity}</TableCell>
                      <TableCell className={isProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {formatCurrency(trade.gross_pl)}
                      </TableCell>
                      <TableCell>{trade.commission ? formatCurrency(trade.commission) : '-'}</TableCell>
                      <TableCell className={isProfit ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {formatCurrency(netPl)}
                      </TableCell>
                      <TableCell>{trade.entry_time ? new Date(trade.entry_time).toLocaleString() : '-'}</TableCell>
                      <TableCell>{trade.exit_time ? new Date(trade.exit_time).toLocaleString() : '-'}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
