import { useMemo } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { PortfolioSnapshot } from "@/hooks/useBacktestResults";
import { finiteEquityNumber, formatEquityReturn } from "@/lib/equityChartData";

export const EquityLineChart = ({ snapshots, currency, intraday = false, initialCapital, capitalInferred = false }: {
  snapshots: PortfolioSnapshot[];
  currency?: string | null;
  intraday?: boolean;
  initialCapital?: number | null;
  capitalInferred?: boolean;
}) => {
  const currencyPrefix = currency ? `${currency} ` : "$";
  const returnLabel = "Cumulative Return %";
  const baseline = finiteEquityNumber(initialCapital);
  const hasBaseline = baseline !== null && baseline > 0;
  const { data, equityDomain, hasEquity } = useMemo(() => {
    let min = Infinity, max = -Infinity;
    const data = snapshots.map(snapshot => {
      const equity = finiteEquityNumber(snapshot.total_value);
      if (equity !== null) { min = Math.min(min, equity); max = Math.max(max, equity); }
      const value = hasBaseline && equity !== null ? (equity / baseline - 1) * 100 : null;
      return { ...snapshot, total_value: equity, cumulative_return: value !== null && Number.isFinite(value) ? value : null };
    });
    const hasEquity = Number.isFinite(min) && Number.isFinite(max);
    const span = max - min;
    const magnitude = Math.max(Math.abs(min), Math.abs(max));
    const padding = span > 0 && Number.isFinite(span) ? span * 0.08 : Math.max(magnitude * 0.0001, 0.01);
    const lower = min - padding, upper = max + padding;
    const equityDomain: [number, number] = hasEquity
      ? [Number.isFinite(lower) ? lower : min, Number.isFinite(upper) ? upper : max] : [0, 1];
    return { data, equityDomain, hasEquity };
  }, [snapshots, baseline, hasBaseline]);
  const formatTime = (value: string) => intraday ? new Date(value).toLocaleString() : new Date(value).toLocaleDateString();
  const money = (value: number) => `${currencyPrefix}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  return <div className="flex h-full flex-col gap-2">
    <div className="min-h-0 flex-1">
      {!hasEquity ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {snapshots.length ? "No valid portfolio equity observations." : "No portfolio snapshots yet."}
      </div> : <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="text-muted-foreground" />
          <XAxis dataKey="date" tickFormatter={formatTime} minTickGap={32} />
          <YAxis yAxisId="left" width={110} domain={equityDomain} tickFormatter={money} />
          <YAxis yAxisId="right" width={90} orientation="right" domain={["auto", "auto"]} tickFormatter={formatEquityReturn} />
          <Tooltip
            formatter={(value: number, name: string) => name === returnLabel
              ? [formatEquityReturn(value), returnLabel] : [money(value), "Equity"]}
            labelFormatter={formatTime}
          />
          <Legend />
          <Line yAxisId="left" type="monotone" dataKey="total_value" stroke="#2563eb" dot={false} strokeWidth={2} name="Equity" connectNulls={false} />
          <Line yAxisId="right" type="monotone" dataKey="cumulative_return" stroke="#f97316" dot={false} strokeWidth={1} name={returnLabel} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>}
    </div>
    <p className="text-xs text-muted-foreground">
      {hasBaseline ? `Cumulative return from ${capitalInferred ? "inferred " : ""}initial capital (${money(baseline)}).` : "Cumulative return unavailable: positive initial capital is required."}
      {" "}Equity axis scales to observed values. Cash movements may affect returns.
    </p>
  </div>;
};
