import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BacktestResultMetrics } from "@/hooks/useBacktestResults";

interface PerformanceMetricsCardProps {
  metrics?: BacktestResultMetrics | null;
  showSharpeInsufficientData?: boolean;
  showSortinoInsufficientData?: boolean;
}

const MetricItem = ({ label, value, format = 'number' }: { label: string; value?: number | null; format?: 'number' | 'percent' | 'currency' | 'integer' | 'duration' }) => {
  const formatPercent = (percentValue: number) => {
    const abs = Math.abs(percentValue);
    if (abs >= 0.01) return `${percentValue.toFixed(2)}%`;
    if (abs > 0) return `${percentValue.toFixed(4)}%`;
    return "0.00%";
  };
  const formatValue = () => {
    if (value === undefined || value === null || Number.isNaN(value)) return '—';
    if (value === Infinity) return '∞';
    if (format === 'percent') return formatPercent(value);
    if (format === 'currency') return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (format === 'integer') return Math.round(value).toString();
    if (format === 'duration') {
      const totalMinutes = Math.floor(value / 60000);
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ''}`;
      if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
      return `${minutes}m`;
    }
    return value.toFixed(2);
  };

  return (
    <div className="p-3 rounded-lg border bg-muted/40">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{formatValue()}</p>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-3">
    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">{title}</h3>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {children}
    </div>
  </div>
);

export const PerformanceMetricsCard = ({
  metrics,
  showSharpeInsufficientData = false,
  showSortinoInsufficientData = false,
}: PerformanceMetricsCardProps) => {
  const isIntradaySessionReturn = metrics?.annualized_return !== undefined && metrics?.total_return !== undefined && Math.abs(metrics.annualized_return - metrics.total_return) < 1e-9;
  const annualizedLabel = isIntradaySessionReturn ? "Session Return" : "Annualized Return";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        {metrics ? (
          <div className="space-y-6">
            <Section title="Key Performance">
              <MetricItem label="Net Profit" value={metrics.net_profit} format="currency" />
              <MetricItem label="Total Return" value={metrics.total_return} format="percent" />
              <MetricItem label={annualizedLabel} value={metrics.annualized_return} format="percent" />
              <MetricItem label="Final Portfolio Value" value={metrics.final_portfolio_value} format="currency" />
            </Section>

            <Section title="Risk Metrics">
              <MetricItem
                label={showSharpeInsufficientData ? "Sharpe Ratio (Not enough data)" : "Sharpe Ratio"}
                value={showSharpeInsufficientData ? undefined : metrics.sharpe_ratio}
              />
              <MetricItem
                label={showSortinoInsufficientData ? "Sortino Ratio (Not enough data)" : "Sortino Ratio"}
                value={showSortinoInsufficientData ? undefined : metrics.sortino_ratio}
              />
              <MetricItem label="Calmar Ratio" value={metrics.calmar_ratio} />
              <MetricItem label="Max Drawdown" value={metrics.max_drawdown} format="percent" />
            </Section>

            <Section title="Trade Statistics">
              <MetricItem label="Total Trades" value={metrics.total_trades} format="integer" />
              <MetricItem label="Winning Trades" value={metrics.profitable_trades} format="integer" />
              <MetricItem label="Losing Trades" value={metrics.losing_trades} format="integer" />
              <MetricItem label="Win Rate" value={metrics.win_rate} format="percent" />
              <MetricItem label="Profit Factor" value={metrics.total_trades === 0 && metrics.profit_factor === 0 ? undefined : (metrics.profit_factor === Infinity ? Number.POSITIVE_INFINITY : metrics.profit_factor)} />
              <MetricItem label="Avg Holding Period" value={metrics.avg_holding_period} format="duration" />
            </Section>

            <Section title="P&L Analysis">
              <MetricItem label="Avg Win" value={metrics.avg_win} format="currency" />
              <MetricItem label="Avg Loss" value={metrics.avg_loss} format="currency" />
              <MetricItem label="Largest Win" value={metrics.largest_win} format="currency" />
              <MetricItem label="Largest Loss" value={metrics.largest_loss} format="currency" />
              <MetricItem label="Expectancy" value={metrics.expectancy} format="currency" />
              <MetricItem label="Avg Trade Return" value={metrics.average_trade_return} format="percent" />
            </Section>

            <Section title="Costs">
              <MetricItem label="Total Commission" value={metrics.total_commission} format="currency" />
              <MetricItem label="Total Slippage" value={metrics.total_slippage} format="currency" />
            </Section>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No performance metrics available yet.</p>
        )}
      </CardContent>
    </Card>
  );
};
