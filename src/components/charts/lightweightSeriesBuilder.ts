import type { Time } from "lightweight-charts";
import type { CorezaCandle, SeriesPoint, VisualizeOverlay } from "./chartTypes";

type ChartLineStyle = 0 | 1 | 2 | 3;
interface PriceLineTarget { createPriceLine: (options: { price: number; color: string; lineStyle: ChartLineStyle; lineWidth: number; axisLabelVisible?: boolean; title?: string }) => void; }
interface ChartLineSeries extends PriceLineTarget { setData: (data: Array<{ time: number; value: number }>) => void; }
interface ChartApi { addLineSeries: (options?: Record<string, unknown>) => ChartLineSeries; }

const LINE_STYLE_DASHED: ChartLineStyle = 2;
const MAX_LEVELS_PER_SIDE = 5;

const toLineData = (points: SeriesPoint[]): Array<{ time: number; value: number }> =>
  points.filter((point) => point.value !== null).map((point) => ({ time: point.time, value: point.value as number }));

const nearestLevels = (levels: number[], currentClose: number | undefined, direction: "support" | "resistance"): number[] => {
  if (!levels.length) return [];
  if (!Number.isFinite(currentClose)) return levels.slice(0, MAX_LEVELS_PER_SIDE);
  const filtered = direction === "support" ? levels.filter((x) => x <= (currentClose as number)) : levels.filter((x) => x >= (currentClose as number));
  return filtered
    .sort((a, b) => Math.abs((currentClose as number) - a) - Math.abs((currentClose as number) - b))
    .slice(0, MAX_LEVELS_PER_SIDE);
};

export const toVolumeData = (candles: CorezaCandle[]) =>
  candles.map((candle) => ({
    time: candle.time as Time,
    value: candle.volume ?? 0,
    color: candle.close >= candle.open ? "#22c55e99" : "#ef444499",
  }));

export const addOverlaySeries = (chart: ChartApi, overlay: VisualizeOverlay): ChartLineSeries[] => {
  const created: ChartLineSeries[] = [];
  if (overlay.kind === "line" || overlay.kind === "panel") {
    const series = chart.addLineSeries({ color: overlay.color, lineWidth: 2, title: overlay.name });
    series.setData(toLineData(overlay.data));
    created.push(series);
    return created;
  }
  if (overlay.kind === "bands") {
    const upper = chart.addLineSeries({ color: overlay.color, lineWidth: 1, title: `${overlay.name} upper` });
    upper.setData(toLineData(overlay.upper));
    created.push(upper);
    if (overlay.middle) {
      const middle = chart.addLineSeries({ color: overlay.color, lineWidth: 1, lineStyle: LINE_STYLE_DASHED, title: `${overlay.name} middle` });
      middle.setData(toLineData(overlay.middle));
      created.push(middle);
    }
    const lower = chart.addLineSeries({ color: overlay.color, lineWidth: 1, title: `${overlay.name} lower` });
    lower.setData(toLineData(overlay.lower));
    created.push(lower);
    return created;
  }

  const anchor = chart.addLineSeries({ color: "transparent", lineVisible: false, lastValueVisible: false, priceLineVisible: false });
  anchor.setData([]);

  nearestLevels(overlay.supports, overlay.currentClose, "support").forEach((price) => anchor.createPriceLine({ price, color: "#22c55e", lineStyle: LINE_STYLE_DASHED, lineWidth: 1, axisLabelVisible: true, title: `${overlay.name} support` }));
  nearestLevels(overlay.resistances, overlay.currentClose, "resistance").forEach((price) => anchor.createPriceLine({ price, color: "#ef4444", lineStyle: LINE_STYLE_DASHED, lineWidth: 1, axisLabelVisible: true, title: `${overlay.name} resistance` }));

  if (overlay.supportSeries) {
    const supportSeries = chart.addLineSeries({ color: "#22c55e", lineWidth: 1, title: `${overlay.name} support` });
    supportSeries.setData(toLineData(overlay.supportSeries));
    created.push(supportSeries);
  }
  if (overlay.resistanceSeries) {
    const resistanceSeries = chart.addLineSeries({ color: "#ef4444", lineWidth: 1, title: `${overlay.name} resistance` });
    resistanceSeries.setData(toLineData(overlay.resistanceSeries));
    created.push(resistanceSeries);
  }
  created.push(anchor);
  return created;
};
