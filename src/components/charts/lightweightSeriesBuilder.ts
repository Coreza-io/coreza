import {
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import type { CorezaCandle, SeriesPoint, VisualizeOverlay } from "./chartTypes";

type ChartLineStyle = 0 | 1 | 2 | 3;
interface PriceLineTarget {
  createPriceLine: (options: {
    price: number;
    color: string;
    lineStyle: ChartLineStyle;
    lineWidth: number;
    axisLabelVisible?: boolean;
    title?: string;
  }) => void;
}
type ChartApi = IChartApi;
type PriceAnchorRange = {
  from: Time;
  to: Time;
};
export type OverlayHandles = {
  series: Array<ISeriesApi<"Line" | "Histogram", Time>>;
  channels: Array<{
    key: string;
    label: string;
    color: string;
    series: ISeriesApi<"Candlestick" | "Line" | "Histogram", Time>;
    staticValue?: number | null;
  }>;
  priceLines: Array<{
    anchor: ISeriesApi<"Candlestick" | "Line" | "Histogram", Time>;
    line: IPriceLine;
  }>;
};

const LINE_STYLE_DASHED: ChartLineStyle = 2;
const MAX_LEVELS_PER_SIDE = 5;
const OVERLAY_SERIES_STYLE = {
  lastValueVisible: false,
  priceLineVisible: false,
} as const;

const getLevelPrecision = (referencePrice: number | undefined): number => {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return 4;
  const magnitude = Math.floor(Math.log10(referencePrice));
  return Math.min(8, Math.max(2, 4 - magnitude));
};

const roundToPrecision = (value: number, precision: number): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const toChartTime = (time: number): Time => {
  return (time > 9999999999 ? Math.floor(time / 1000) : time) as Time;
};

const toLineData = (
  points: SeriesPoint[],
): Array<{ time: Time; value: number }> =>
  points
    .filter((point) => point.value !== null)
    .map((point) => ({
      time: toChartTime(point.time),
      value: point.value,
    }));

const nearestLevels = (
  levels: number[],
  currentClose: number | undefined,
  direction: "support" | "resistance",
): number[] => {
  if (!levels.length) return [];
  if (!Number.isFinite(currentClose))
    return levels.slice(0, MAX_LEVELS_PER_SIDE);
  const filtered =
    direction === "support"
      ? levels.filter((x) => x <= currentClose)
      : levels.filter((x) => x >= currentClose);
  return filtered
    .sort(
      (a, b) =>
        Math.abs(currentClose - a) -
        Math.abs(currentClose - b),
    )
    .slice(0, MAX_LEVELS_PER_SIDE);
};

export const toVolumeData = (candles: CorezaCandle[]) =>
  candles.map((candle) => ({
    time: toChartTime(candle.time),
    value: candle.volume ?? 0,
    color: candle.close >= candle.open ? "#22c55e99" : "#ef444499",
  }));

export const addOverlaySeries = (
  chart: ChartApi,
  overlay: VisualizeOverlay,
  priceAnchor?: ISeriesApi<"Candlestick" | "Line", Time>,
  priceAnchorRange?: PriceAnchorRange,
): OverlayHandles => {
  const handles: OverlayHandles = { series: [], channels: [], priceLines: [] };
  if (overlay.kind === "line" || overlay.kind === "panel") {
    const series = chart.addSeries(LineSeries, {
      color: overlay.color,
      lineWidth: 2,
      ...OVERLAY_SERIES_STYLE,
    });
    series.setData(toLineData(overlay.data));
    handles.series.push(series);
    handles.channels.push({
      key: overlay.id,
      label: overlay.name,
      color: overlay.color,
      series,
    });
    return handles;
  }
  if (overlay.kind === "multi") {
    overlay.channels.forEach((channel, index) => {
      const series =
        channel.style === "histogram"
          ? chart.addSeries(HistogramSeries, {
              color: channel.color,
              ...OVERLAY_SERIES_STYLE,
            })
          : chart.addSeries(LineSeries, {
              color: channel.color,
              lineWidth: 2,
              lineStyle: channel.dashed ? LINE_STYLE_DASHED : undefined,
              ...OVERLAY_SERIES_STYLE,
            });
      series.setData(toLineData(channel.data));
      handles.series.push(series);
      handles.channels.push({
        key: channel.label,
        label: channel.label,
        color: channel.color,
        series,
      });
      if (index === 0 && overlay.referenceLines?.length) {
        overlay.referenceLines.forEach((ref) => {
          const line = series.createPriceLine({
            price: ref.price,
            color: ref.color,
            lineStyle: LINE_STYLE_DASHED,
            lineWidth: 1,
            axisLabelVisible: true,
            title: ref.label,
          });
          handles.priceLines.push({ anchor: series, line });
        });
      }
    });
    return handles;
  }
  if (overlay.kind === "bands") {
    const upper = chart.addSeries(LineSeries, {
      color: overlay.color,
      lineWidth: 1,
      ...OVERLAY_SERIES_STYLE,
    });
    upper.setData(toLineData(overlay.upper));
    handles.series.push(upper);
    handles.channels.push({
      key: "upper",
      label: "upper",
      color: overlay.color,
      series: upper,
    });
    if (overlay.middle) {
      const middle = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: 1,
        lineStyle: LINE_STYLE_DASHED,
        ...OVERLAY_SERIES_STYLE,
      });
      middle.setData(toLineData(overlay.middle));
      handles.series.push(middle);
      handles.channels.push({
        key: "middle",
        label: "middle",
        color: overlay.color,
        series: middle,
      });
    }
    const lower = chart.addSeries(LineSeries, {
      color: overlay.color,
      lineWidth: 1,
      ...OVERLAY_SERIES_STYLE,
    });
    lower.setData(toLineData(overlay.lower));
    handles.series.push(lower);
    handles.channels.push({
      key: "lower",
      label: "lower",
      color: overlay.color,
      series: lower,
    });
    return handles;
  }

  const fallbackSeries =
    priceAnchor === undefined
      ? chart.addSeries(LineSeries, {
          color: "transparent",
          lineVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        })
      : undefined;
  const priceLineTarget = priceAnchor ?? fallbackSeries;
  if (!priceLineTarget) {
    return handles;
  }

  if (fallbackSeries) {
    const fallbackRange =
      priceAnchorRange ??
      ({
        from: toChartTime(Math.floor(Date.now() / 1000)),
        to: toChartTime(Math.floor(Date.now() / 1000) + 1),
      } satisfies PriceAnchorRange);
    const fallbackPrice =
      nearestLevels(overlay.supports, overlay.currentClose, "support")[0] ??
      nearestLevels(overlay.resistances, overlay.currentClose, "resistance")[0] ??
      overlay.currentClose ??
      0;

    fallbackSeries.setData([
      { time: fallbackRange.from, value: fallbackPrice },
      { time: fallbackRange.to, value: fallbackPrice },
    ]);
  }

  const levelPrecision = getLevelPrecision(overlay.currentClose);
  const addLevelPriceLine = (price: number, color: string, title: string, lineStyle: ChartLineStyle) => {
    const line = priceLineTarget.createPriceLine({
      price: roundToPrecision(price, levelPrecision),
      color,
      lineStyle,
      lineWidth: 1,
      axisLabelVisible: true,
      title,
    });
    handles.priceLines.push({ anchor: priceLineTarget, line });
  };

  nearestLevels(overlay.supports, overlay.currentClose, "support").forEach(
    (price) => {
      addLevelPriceLine(price, "#22c55e", "support", LINE_STYLE_DASHED);
    },
  );
  nearestLevels(
    overlay.resistances,
    overlay.currentClose,
    "resistance",
  ).forEach((price) => {
    addLevelPriceLine(price, "#ef4444", "resistance", LINE_STYLE_DASHED);
  });

  if (overlay.pivot !== null && overlay.pivot !== undefined && Number.isFinite(overlay.pivot)) {
    addLevelPriceLine(overlay.pivot, "#eab308", "pivot", LINE_STYLE_DASHED);
    handles.channels.push({ key: "pivot", label: "pivot", color: "#eab308", series: fallbackSeries ?? priceLineTarget, staticValue: overlay.pivot });
  }
  if (overlay.highestHigh !== null && overlay.highestHigh !== undefined && Number.isFinite(overlay.highestHigh)) {
    addLevelPriceLine(overlay.highestHigh, "#ef4444", "HH", 3);
    handles.channels.push({ key: "highest_high", label: "highest_high", color: "#ef4444", series: fallbackSeries ?? priceLineTarget, staticValue: overlay.highestHigh });
  }
  if (overlay.lowestLow !== null && overlay.lowestLow !== undefined && Number.isFinite(overlay.lowestLow)) {
    addLevelPriceLine(overlay.lowestLow, "#22c55e", "LL", 3);
    handles.channels.push({ key: "lowest_low", label: "lowest_low", color: "#22c55e", series: fallbackSeries ?? priceLineTarget, staticValue: overlay.lowestLow });
  }

  if (overlay.supportSeries) {
    const supportSeries = chart.addSeries(LineSeries, {
      color: "#22c55e",
      lineWidth: 1,
      ...OVERLAY_SERIES_STYLE,
    });
    supportSeries.setData(toLineData(overlay.supportSeries));
    handles.series.push(supportSeries);
    handles.channels.push({
      key: "support",
      label: "support",
      color: "#22c55e",
      series: supportSeries,
    });
  }
  if (overlay.resistanceSeries) {
    const resistanceSeries = chart.addSeries(LineSeries, {
      color: "#ef4444",
      lineWidth: 1,
      ...OVERLAY_SERIES_STYLE,
    });
    resistanceSeries.setData(toLineData(overlay.resistanceSeries));
    handles.series.push(resistanceSeries);
    handles.channels.push({
      key: "resistance",
      label: "resistance",
      color: "#ef4444",
      series: resistanceSeries,
    });
  }
  if (fallbackSeries) {
    handles.series.push(fallbackSeries);
  }
  return handles;
};
