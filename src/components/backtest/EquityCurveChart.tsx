import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
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

export const EquityCurveChart = ({ snapshots }: EquityCurveChartProps) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Equity Curve</CardTitle>
          <p className="text-sm text-muted-foreground">Portfolio equity over time</p>
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
              <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString()} minTickGap={32} />
              <YAxis yAxisId="left" tickFormatter={(value) => `$${value.toLocaleString()}`} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `${value?.toFixed(2) || 0}%`} />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (name === 'daily_return') {
                    return [`${Number(value).toFixed(2)}%`, 'Daily Return'];
                  }
                  return [`$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, name === 'total_value' ? 'Equity' : name];
                }}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="total_value" stroke="#2563eb" dot={false} strokeWidth={2} name="Equity" />
              <Line yAxisId="right" type="monotone" dataKey="daily_return" stroke="#f97316" dot={false} strokeWidth={1} name="Daily Return %" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
};
