import { useEffect, useId, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import type { PortfolioSnapshot } from "@/hooks/useBacktestResults";
import { buildEquityChartData } from "@/lib/equityChartData";
import { EquityLineChart } from "./EquityLineChart";
import { EquityCandlestickChart } from "./EquityCandlestickChart";
import type { EquityChartContext, EquityChartType, EquityInterval } from "./equityChartTypes";

function readPreference(key: string | null): EquityChartType {
  try { return key && localStorage.getItem(key) === "candle" ? "candle" : "line"; }
  catch { return "line"; }
}

export const EquityCurveChart = ({ snapshots, currency, intraday = false, context }: {
  snapshots: PortfolioSnapshot[];
  currency?: string | null;
  intraday?: boolean;
  context: EquityChartContext;
}) => {
  const { user } = useAuth();
  const chartTypeId = useId();
  const intervalId = useId();
  const preferenceKey = user ? `coreza:equity-chart:v1:${user.id}` : null;
  const [choice, setChoice] = useState<{ key: string | null; type: EquityChartType } | null>(null);
  const preference = useMemo(() => choice?.key === preferenceKey ? choice.type : readPreference(preferenceKey), [choice, preferenceKey]);
  const [interval, setInterval] = useState<EquityInterval>("auto");
  const [now, setNow] = useState(Date.now);
  const model = useMemo(() => buildEquityChartData(snapshots, context, interval, Date.now()), [snapshots, context, interval, now]);
  const last = model.candles[model.candles.length - 1];
  useEffect(() => {
    if (!last?.isProvisional) return;
    // Local display rollover only: no network polling or subscriptions.
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(1, last.endMs - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [last?.isProvisional, last?.endMs]);
  const chartType = model.candleAvailable ? preference : "line";
  const chooseType = (type: EquityChartType) => {
    setChoice({ key: preferenceKey, type });
    try { if (preferenceKey) localStorage.setItem(preferenceKey, type); } catch { /* Storage can be blocked. */ }
  };

  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
      <div>
        <CardTitle>Equity Curve</CardTitle>
        <p className="text-sm text-muted-foreground">Portfolio equity over time</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-1">
          <label htmlFor={chartTypeId} className="text-xs text-muted-foreground">Chart type</label>
          <Select value={chartType} onValueChange={value => { if (value === "line" || value === "candle") chooseType(value); }}>
            <SelectTrigger id={chartTypeId} className="min-h-10 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="line">Line</SelectItem>
              <SelectItem value="candle" disabled={!model.candleAvailable}>Candle</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {chartType === "candle" && <div className="space-y-1">
          <label htmlFor={intervalId} className="text-xs text-muted-foreground">Interval</label>
          <Select value={interval} onValueChange={value => setInterval(value as EquityInterval)}>
            <SelectTrigger id={intervalId} className="min-h-10 w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{(context.mode === "backtest" ? ["auto", "1D", "1W", "1M"] : ["auto", "1m", "5m", "15m", "1h", "1D"]).map(value => <SelectItem key={value} value={value}>{value === "auto" ? "Auto" : value}</SelectItem>)}</SelectContent>
          </Select>
        </div>}
      </div>
    </CardHeader>
    {model.unavailableReason && <p role="note" className="px-6 pb-3 text-sm text-muted-foreground">{model.unavailableReason}</p>}
    <CardContent className={chartType === "line" ? "h-[360px]" : undefined}>
      {chartType === "line" ? <EquityLineChart snapshots={snapshots} currency={currency} intraday={intraday} initialCapital={context.initialCapital} capitalInferred={context.capitalInferred} /> :
        <EquityCandlestickChart model={model} context={context} currency={currency} />}
    </CardContent>
  </Card>;
};
