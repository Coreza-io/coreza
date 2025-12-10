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
        <div className="min-w-[700px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>Slippage</TableHead>
                <TableHead>Portfolio Before</TableHead>
                <TableHead>Portfolio After</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No trades yet.
                  </TableCell>
                </TableRow>
              ) : (
                trades.map((trade) => {
                  const isBuy = trade.action?.toLowerCase() === 'buy';
                  return (
                    <TableRow key={trade.id} className="text-sm">
                      <TableCell className="font-medium">{trade.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={isBuy ? 'secondary' : 'outline'}>{trade.action}</Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(trade.price)}</TableCell>
                      <TableCell>{trade.quantity}</TableCell>
                      <TableCell>{trade.commission ? formatCurrency(trade.commission) : '-'}</TableCell>
                      <TableCell>{trade.slippage ? formatCurrency(trade.slippage) : '-'}</TableCell>
                      <TableCell>{trade.portfolio_value_before ? formatCurrency(trade.portfolio_value_before) : '-'}</TableCell>
                      <TableCell>{trade.portfolio_value_after ? formatCurrency(trade.portfolio_value_after) : '-'}</TableCell>
                      <TableCell>{new Date(trade.timestamp).toLocaleString()}</TableCell>
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
