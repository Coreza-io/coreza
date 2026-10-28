import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, LineSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart,
  type CandlestickData, type LineData, type HistogramData, type IChartApi, type ISeriesApi, type IPriceLine,
  type MouseEventParams, type UTCTimestamp, type WhitespaceData,
} from "lightweight-charts";
import { Button } from "@/components/ui/button";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { formatEquityReturn } from "@/lib/equityChartData";
import type { EquityCandle, EquityChartContext, EquityChartModel, EquityChartType } from "./equityChartTypes";

const chartTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
const utc = (ms: number) => new Date(ms).toLocaleString(undefined, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });

function themeColor(name: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = `hsl(var(--${name}))`;
  document.documentElement.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || fallback;
}

function colors() {
  return {
    background: themeColor("background", "#ffffff"), text: themeColor("foreground", "#171717"),
    grid: themeColor("border", "#e5e7eb"), up: themeColor("success", "#16a34a"),
    down: themeColor("destructive", "#dc2626"), blue: themeColor("primary", "#2563eb"),
  };
}

export function EquityHistoryChart({ model, context, currency, chartType }: {
  model: EquityChartModel; context: EquityChartContext; currency?: string | null; chartType: EquityChartType;
}) {
  const theme = useResolvedTheme();
  const summaryId = useId();
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const equity = useRef<ISeriesApi<"Candlestick" | "Line"> | null>(null);
  const returns = useRef<ISeriesApi<"Histogram"> | null>(null);
  const zeroLine = useRef<IPriceLine | null>(null);
  const fitted = useRef(false);
  const previousInterval = useRef(model.interval);
  const previousTimeline = useRef<(CandlestickData | WhitespaceData)[]>([]);
  const buckets = useRef(new Map<number, EquityCandle>());
  const [hover, setHover] = useState<{ candle: EquityCandle; x: number; y: number } | null>(null);
  const [showEquity, setShowEquity] = useState(true);
  const [showReturn, setShowReturn] = useState(true);
  const [tablePage, setTablePage] = useState(0);
  const prefix = currency ? `${currency} ` : "$";
  const money = (value: number) => `${prefix}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const latest = model.candles[model.candles.length - 1];
  const allSparse = useMemo(() => model.candles.length > 0 && model.candles.every(candle => candle.quality === "sparse"), [model.candles]);

  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    const palette = colors();
    const instance = createChart(element, {
      width: element.clientWidth, height: element.clientHeight,
      layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text,
        fontFamily: getComputedStyle(element).fontFamily, attributionLogo: true },
      grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
      rightPriceScale: { borderColor: palette.grid, minimumWidth: 90 },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: palette.grid },
      localization: { timeFormatter: time => typeof time === "number" ? `${utc(time * 1000)} UTC` : String(time) },
    });
    const equitySeries = chartType === "line" ? instance.addSeries(LineSeries, {
      color: palette.blue, lineWidth: 2, priceLineVisible: false,
    }, 0) : instance.addSeries(CandlestickSeries, {
      upColor: palette.up, downColor: palette.down, wickUpColor: palette.up, wickDownColor: palette.down,
      borderUpColor: palette.up, borderDownColor: palette.down, lastValueVisible: true, priceLineVisible: false,
    }, 0);
    const returnSeries = instance.addSeries(HistogramSeries, {
      color: palette.blue, base: 0, priceLineVisible: false,
      priceFormat: { type: "custom", formatter: formatEquityReturn },
    }, 1);
    const zero = returnSeries.createPriceLine({ price: 0, color: palette.grid, lineWidth: 1,
      lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "" });
    zeroLine.current = zero;
    instance.panes()[0].setStretchFactor(3);
    instance.panes()[1].setStretchFactor(1);
    const onCrosshair = (event: MouseEventParams) => {
      const candle = typeof event.time === "number" ? buckets.current.get(event.time) : undefined;
      if (!candle || !event.point || event.point.x < 0 || event.point.y < 0) { setHover(null); return; }
      setHover({ candle, x: Math.max(4, Math.min(event.point.x + 12, element.clientWidth - 272)), y: 12 });
    };
    instance.subscribeCrosshairMove(onCrosshair);
    const resize = new ResizeObserver(() => instance.resize(element.clientWidth, element.clientHeight));
    resize.observe(element);
    chart.current = instance; equity.current = equitySeries; returns.current = returnSeries;
    fitted.current = false;
    return () => {
      resize.disconnect();
      instance.unsubscribeCrosshairMove(onCrosshair);
      returnSeries.removePriceLine(zero);
      instance.remove();
      chart.current = null; equity.current = null; returns.current = null; zeroLine.current = null;
      // The ref can alias seriesData.lookup, which Strict Mode reuses on setup.
      // Never mutate that memoized map during effect cleanup.
      buckets.current = new Map();
      previousTimeline.current = [];
    };
  }, [context.runId, chartType]);

  useEffect(() => {
    const applyTheme = () => {
      const palette = colors();
      chart.current?.applyOptions({ layout: { background: { type: ColorType.Solid, color: palette.background }, textColor: palette.text },
        grid: { vertLines: { color: palette.grid }, horzLines: { color: palette.grid } },
        rightPriceScale: { borderColor: palette.grid }, timeScale: { borderColor: palette.grid } });
      const priceFormat = { type: "custom" as const, minMove: 0.01, formatter: (value: number) => `${prefix}${Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(value)}` };
      if (chartType === "line") equity.current?.applyOptions({ color: palette.blue, priceFormat });
      else equity.current?.applyOptions({ upColor: palette.up, downColor: palette.down, wickUpColor: palette.up,
        wickDownColor: palette.down, borderUpColor: palette.up, borderDownColor: palette.down,
        priceFormat });
      returns.current?.applyOptions({ color: palette.blue });
      zeroLine.current?.applyOptions({ color: palette.grid });
    };
    applyTheme();
    // A provider can apply its initial root class after this child's effect
    // without changing resolvedTheme. Observe the actual CSS boundary as well.
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [theme, prefix, context.runId, chartType]);

  const seriesData = useMemo(() => {
    const candles: (CandlestickData | WhitespaceData)[] = [];
    const line: (LineData | WhitespaceData)[] = [];
    const histogram: (HistogramData | WhitespaceData)[] = [];
    const lookup = new Map<number, EquityCandle>();
    let smallestReturn = Infinity;
    for (let index = 0; index < model.candles.length; index++) {
      const candle = model.candles[index];
      // One whitespace marker per gap, never fabricated equity or zero returns.
      if (candle.returnSpansGap) {
        const time = chartTime(model.candles[index - 1].endMs);
        candles.push({ time }); line.push({ time }); histogram.push({ time });
      }
      const time = chartTime(candle.startMs);
      candles.push({ time, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
      line.push({ time, value: candle.close });
      histogram.push(candle.returnPct === null ? { time } : { time, value: candle.returnPct });
      if (candle.returnPct !== null && candle.returnPct !== 0) smallestReturn = Math.min(smallestReturn, Math.abs(candle.returnPct));
      lookup.set(time, candle);
    }
    // Custom text formatting alone does not change the library's 0.01 tick
    // resolution. Use decimal ticks small enough for observed percentage points.
    const returnMinMove = Number.isFinite(smallestReturn)
      ? Math.max(1e-15, Math.min(0.01, 10 ** (Math.floor(Math.log10(smallestReturn)) - 1))) : 0.01;
    return { candles, line, histogram, lookup, returnMinMove };
  }, [model.candles]);

  useEffect(() => {
    if (!chart.current || !equity.current || !returns.current) return;
    const range = chart.current.timeScale().getVisibleRange();
    const logicalRange = chart.current.timeScale().getVisibleLogicalRange();
    const samePrefix = previousTimeline.current.every((point, index) => seriesData.candles[index]?.time === point.time);
    const changedInterval = previousInterval.current !== model.interval;
    buckets.current = seriesData.lookup;
    setHover(null);
    returns.current.applyOptions({ priceFormat: { type: "custom", minMove: seriesData.returnMinMove, formatter: formatEquityReturn } });
    equity.current.setData(chartType === "line" ? seriesData.line : seriesData.candles);
    returns.current.setData(seriesData.histogram);
    if (model.candles.length && (!fitted.current || changedInterval)) {
      if (model.candles.length > 1000) {
        const from = chartTime(model.candles[model.candles.length - 1000].startMs);
        chart.current.timeScale().setVisibleRange({ from, to: chartTime(model.candles[model.candles.length - 1].startMs) });
      } else chart.current.timeScale().fitContent();
      fitted.current = true;
    } else if (model.candles.length) {
      // Timestamp ranges round to whole bars. Retain fractional zoom/pan on
      // ordinary refresh/appends; use timestamps when historical inserts shift indexes.
      if (samePrefix && logicalRange) chart.current.timeScale().setVisibleLogicalRange(logicalRange);
      else if (range) chart.current.timeScale().setVisibleRange(range);
    } else fitted.current = false;
    previousInterval.current = model.interval;
    previousTimeline.current = seriesData.candles;
  }, [seriesData, model.interval, model.candles, context.runId, chartType]);

  useEffect(() => {
    equity.current?.applyOptions({ visible: showEquity });
    returns.current?.applyOptions({ visible: showReturn });
  }, [showEquity, showReturn, context.runId, chartType]);

  const tableStart = Math.min(tablePage * 25, Math.max(0, Math.ceil(model.candles.length / 25) - 1) * 25);
  const tableRows = model.candles.slice(tableStart, tableStart + 25);
  const candleValues = (candle: EquityCandle) => <>
    {chartType === "candle" ? <><div>Open {money(candle.open)}</div><div>High {money(candle.high)}</div>
    <div>Low {money(candle.low)}</div><div>Close {money(candle.close)}</div></> : <div>Equity {money(candle.close)}</div>}
    <div>Return {formatEquityReturn(candle.returnPct)}</div>
    <div>{candle.sampleCount} {candle.sampleCount === 1 ? "sample" : "samples"}{candle.quality === "sparse" ? " · Sparse" : ""}{candle.isProvisional ? " · Provisional" : ""}</div>
    {candle.returnSpansGap && <div>Return spans a gap since the previous observed bucket.</div>}
  </>;

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">Sampled equity · {model.interval} · UTC{context.capitalInferred ? " · Initial capital inferred" : ""}</p>
      <div className="flex gap-2">
        <Button size="sm" variant={showEquity ? "secondary" : "outline"} aria-pressed={showEquity}
          disabled={showEquity && !showReturn} onClick={() => setShowEquity(value => !value)}>Equity</Button>
        <Button size="sm" variant={showReturn ? "secondary" : "outline"} aria-pressed={showReturn}
          disabled={showReturn && !showEquity} onClick={() => setShowReturn(value => !value)}>Return</Button>
        <Button size="sm" variant="outline" onClick={() => chart.current?.timeScale().fitContent()}>All / reset</Button>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">{chartType === "line" ? "Blue line: closing equity. " : "Candles: observed equity OHLC. "}Blue bars below: period return from the previous observed bucket close; the first compares with initial capital when available.</p>
    {!model.candleAvailable && <p className="text-xs text-muted-foreground">Line uses saved closing equity observations only; unavailable OHLC is not shown.</p>}
    {chartType === "candle" && context.mode === "backtest" && (model.interval === "1W" || model.interval === "1M") && <p role="note" className="text-xs text-muted-foreground">Observed daily equity grouped into {model.interval === "1W" ? "weekly (Monday–Monday)" : "calendar-month"} candles. High/low reflect saved equity observations, not unobserved intraday extremes.</p>}
    {chartType === "candle" && context.mode === "backtest" && model.interval === "1D" && allSparse && <p role="note" className="text-xs text-muted-foreground">This run has one equity observation per day, so daily O/H/L/C are equal. Choose Auto, 1W or 1M to group observations, or rerun with intraday input data for daily equity ranges.</p>}
    {model.candles.length > 1000 && <p className="text-xs text-muted-foreground">Initially showing the most recent 1,000 buckets. Pan to earlier history or choose All / reset; all loaded history is retained.</p>}
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div ref={container} className="h-[420px] min-h-[360px] w-full" role="img" aria-label={`Portfolio equity ${chartType === "line" ? "line" : "candles"} above period return bars`} aria-describedby={summaryId} />
      {!latest && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No portfolio snapshots yet.</div>}
      {hover && <div className="pointer-events-none absolute z-10 w-64 max-w-full rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
        style={{ left: hover.x, top: hover.y }}>
        <div className="mb-1 font-medium">{utc(hover.candle.startMs)} – {utc(hover.candle.endMs)} UTC</div>
        {candleValues(hover.candle)}
        {hover.candle.firstObservedMs !== null && <div className="mt-1 text-muted-foreground">Observed {utc(hover.candle.firstObservedMs)} – {utc(hover.candle.lastObservedMs!)} UTC</div>}
      </div>}
    </div>
    <div id={summaryId} className="text-xs text-muted-foreground">
      {latest ? <><span className="font-medium">Latest bucket: {utc(latest.startMs)} UTC. </span>
        {chartType === "candle" ? <>O {money(latest.open)}, H {money(latest.high)}, L {money(latest.low)}, C {money(latest.close)}</> : <>Equity {money(latest.close)}</>}; return {formatEquityReturn(latest.returnPct)}; {latest.sampleCount} samples{latest.isProvisional ? "; provisional" : ""}.</> : "No valid observed equity data."}
      {allSparse && <p>Each bucket has one observed valuation{chartType === "candle" ? " and appears as a doji" : ""}.</p>}
      {(model.diagnostics.invalidRows > 0 || model.diagnostics.duplicateRows > 0 || model.diagnostics.foreignRows > 0) && <p>Excluded invalid rows: {model.diagnostics.invalidRows}; simultaneous duplicates: {model.diagnostics.duplicateRows}; other sources: {model.diagnostics.foreignRows}.</p>}
      <p>Equity observations omit changes between samples. Cash movements may affect returns.</p>
    </div>
    {latest && <details className="text-xs">
      <summary className="cursor-pointer py-2">Inspect equity buckets as a table</summary>
      <div className="overflow-x-auto">
        <table className="w-full text-left"><caption className="sr-only">Sampled equity and period returns in UTC, {currency || "USD"}</caption>
          <thead><tr>{["Start / end (UTC)", ...(chartType === "candle" ? ["Open", "High", "Low", "Close"] : ["Equity"]), "Return", "Samples / status"].map(label => <th key={label} scope="col" className="px-2 py-2">{label}</th>)}</tr></thead>
          <tbody>{tableRows.map(candle => <tr key={candle.startMs} className="border-t">
            <th scope="row" className="px-2 py-2 font-normal">{utc(candle.startMs)} / {utc(candle.endMs)}</th>
            {(chartType === "candle" ? [candle.open, candle.high, candle.low, candle.close] : [candle.close]).map((value, index) => <td key={index} className="px-2 py-2">{money(value)}</td>)}
            <td className="px-2 py-2">{formatEquityReturn(candle.returnPct)}{candle.returnSpansGap ? " (spans gap)" : ""}</td>
            <td className="px-2 py-2">{candle.sampleCount} · {candle.quality}{candle.isProvisional ? " · provisional" : ""}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" disabled={tableStart === 0} onClick={() => setTablePage(Math.max(0, tableStart / 25 - 1))}>Previous</Button>
        <span>{tableStart + 1}–{Math.min(tableStart + 25, model.candles.length)} of {model.candles.length}</span>
        <Button size="sm" variant="outline" disabled={tableStart + 25 >= model.candles.length} onClick={() => setTablePage(tableStart / 25 + 1)}>Next</Button>
        <Button size="sm" variant="outline" onClick={() => setTablePage(Math.ceil(model.candles.length / 25) - 1)}>Latest</Button>
      </div>
    </details>}
    <p className="text-[10px] text-muted-foreground">TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc. <a className="underline" href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a></p>
  </div>;
}
