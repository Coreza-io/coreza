import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Area,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PortfolioSnapshot } from "@/hooks/useBacktestResults";

interface EquityCurveChartProps {
  snapshots: PortfolioSnapshot[];
}

const formatPercent = (value?: number) => {
  if (value === undefined || value === null) return '-';
  return `${value.toFixed(2)}%`;
};

export const EquityCurveChart = ({ snapshots }: EquityCurveChartProps) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Equity Curve</CardTitle>
          <p className="text-sm text-muted-foreground">Portfolio equity over time with drawdown overlay</p>
        </div>
      </CardHeader>
      <CardContent className="h-[360px]">
        {snapshots.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No portfolio snapshots yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={snapshots} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="text-muted-foreground" />
              <XAxis dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleDateString()} minTickGap={32} />
              <YAxis yAxisId="left" tickFormatter={(value) => `$${value.toLocaleString()}`} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={formatPercent} />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (name === 'drawdown') {
                    return [formatPercent(value), 'Drawdown'];
                  }
                  return [`$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 'Equity'];
                }}
                labelFormatter={(label) => new Date(label).toLocaleString()}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="equity" stroke="#2563eb" dot={false} strokeWidth={2} name="Equity" />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="drawdown"
                stroke="#f97316"
                fill="#f97316"
                fillOpacity={0.15}
                name="Drawdown"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
};
