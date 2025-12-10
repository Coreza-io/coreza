import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BacktestResultMetrics } from "@/hooks/useBacktestResults";

interface PerformanceMetricsCardProps {
  metrics?: BacktestResultMetrics | null;
}

const MetricItem = ({ label, value, format = 'number' }: { label: string; value?: number | null; format?: 'number' | 'percent' | 'currency' }) => {
  const formatValue = () => {
    if (value === undefined || value === null) return '—';
    if (format === 'percent') return `${value.toFixed(2)}%`;
    if (format === 'currency') return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return value.toFixed(2);
  };

  return (
    <div className="p-3 rounded-lg border bg-muted/40">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{formatValue()}</p>
    </div>
  );
};

export const PerformanceMetricsCard = ({ metrics }: PerformanceMetricsCardProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        {metrics ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricItem label="Total Return" value={metrics.total_return} format="percent" />
            <MetricItem label="Annualized Return" value={metrics.annualized_return} format="percent" />
            <MetricItem label="Sharpe Ratio" value={metrics.sharpe_ratio} />
            <MetricItem label="Max Drawdown" value={metrics.max_drawdown} format="percent" />
            <MetricItem label="Win Rate" value={metrics.win_rate} format="percent" />
            <MetricItem label="Average Trade" value={metrics.average_trade_return} format="percent" />
            <MetricItem label="Largest Win" value={metrics.largest_win} format="percent" />
            <MetricItem label="Largest Loss" value={metrics.largest_loss} format="percent" />
            <MetricItem label="Total Trades" value={metrics.total_trades} />
            <MetricItem label="Profitable Trades" value={metrics.profitable_trades} />
            <MetricItem label="Final Portfolio Value" value={metrics.final_portfolio_value} format="currency" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No performance metrics available yet.</p>
        )}
      </CardContent>
    </Card>
  );
};
