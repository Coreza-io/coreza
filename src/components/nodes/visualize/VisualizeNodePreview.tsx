import React, { useMemo } from "react";
import LightweightVisualizeChart from "@/components/charts/LightweightVisualizeChart";
import type { SeriesPoint, VisualizeChartViewModel, VisualizeOverlay } from "@/components/charts/chartTypes";
import { resolveReferences } from "@/utils/resolveReferences";
import { getIndicatorSpec } from "@/utils/indicatorRegistry";
import { alignSeriesToCandles, classifyOverlay, extractBars, getPaletteColor } from "@/utils/visualizeNormalize";

type OverlayRow = { id?: string; name?: string; data?: string; render?: string; color?: string; indicatorType?: string };

const getSeriesSource = (resolved: unknown): unknown => {
  if (Array.isArray(resolved)) return resolved;
  if (resolved && typeof resolved === "object") {
    const rec = resolved as Record<string, unknown>;
    return rec.values ?? rec.data ?? rec.series ?? resolved;
  }
  return resolved;
};

const toHistoricalSeries = (candles: VisualizeChartViewModel["candles"], points?: Array<{ time: number; value: number }>): SeriesPoint[] | undefined => {
  if (!points?.length) return undefined;
  return alignSeriesToCandles(candles, points);
};

const unwrapSeriesArray = (value: unknown): Array<Record<string, unknown> | number> | undefined => {
  const src = getSeriesSource(value);
  return Array.isArray(src) ? (src as Array<Record<string, unknown> | number>) : undefined;
};

const unwrapRow = (row: Record<string, unknown> | number): Record<string, unknown> | number => {
  if (typeof row !== "object" || row === null) return row;
  const rec = row as Record<string, unknown>;
  if (rec.value && typeof rec.value === "object") return rec.value as Record<string, unknown>;
  return rec;
};

const readNumeric = (row: Record<string, unknown> | number, key: string, aliases?: string[]): number | null => {
  if (typeof row === "number") return Number.isFinite(row) ? row : null;
  const unwrapped = unwrapRow(row);
  if (typeof unwrapped === "number") return Number.isFinite(unwrapped) ? unwrapped : null;
  const rec = unwrapped as Record<string, unknown>;
  const readValue = (field: string): unknown => rec[field] ?? (field === "value" ? rec.v ?? rec.close ?? rec.c : undefined);
  const primary = readValue(key);
  if (typeof primary === "number" && Number.isFinite(primary)) return primary;
  for (const alias of aliases ?? []) {
    const candidate = readValue(alias);
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
};

const readTime = (row: Record<string, unknown> | number, fallbackIndex: number): number => {
  if (typeof row !== "object" || row === null) return fallbackIndex;
  const rec = unwrapRow(row);
  if (typeof rec !== "object" || rec === null) return fallbackIndex;
  const candidate = (rec.time ?? rec.t ?? rec.timestamp) as unknown;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : fallbackIndex;
};

const buildSeriesPoints = (
  rows: Array<Record<string, unknown> | number>,
  key: string,
  aliases?: string[],
): Array<{ time: number; value: number | null }> =>
  rows.map((item, index) => ({
    time: readTime(item, index),
    value: readNumeric(item, key, aliases),
  }));

const rowsHaveRealTime = (rows: Array<Record<string, unknown> | number>): boolean =>
  rows.some((row) => {
    if (typeof row !== "object" || row === null) return false;
    const rec = unwrapRow(row);
    if (typeof rec !== "object" || rec === null) return false;
    const timeValue = rec.time ?? rec.t ?? rec.timestamp;
    return typeof timeValue === "number" || typeof timeValue === "string";
  });

const buildChannelSeries = (
  candles: VisualizeChartViewModel["candles"],
  rows: Array<Record<string, unknown> | number>,
  key: string,
  aliases?: string[],
): SeriesPoint[] => {
  if (rowsHaveRealTime(rows)) {
    return alignSeriesToCandles(candles, buildSeriesPoints(rows, key, aliases));
  }
  const numeric = rows
    .map((row) => readNumeric(row, key, aliases))
    .filter((value): value is number => value !== null);
  return alignSeriesToCandles(candles, numeric);
};

const stableId = (row: OverlayRow): string => {
  if (row.id && row.id.trim()) return row.id;
  const base = JSON.stringify([row.name ?? "", row.data ?? "", row.render ?? "", row.color ?? ""]);
  let hash = 0;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 31 + base.charCodeAt(i)) | 0;
  return `overlay-${Math.abs(hash)}`;
};

const VisualizeNodePreview: React.FC<{
  fieldState: Record<string, unknown>;
  sourceData: unknown;
  allNodeData: Record<string, unknown>;
}> = ({ fieldState, sourceData, allNodeData }) => {
  const viewModel = useMemo<VisualizeChartViewModel>(() => {
    const resolvedCandles = resolveReferences(
      String(fieldState.candles ?? ""),
      sourceData,
      allNodeData
    );
    const candles = extractBars(resolvedCandles);
    const currentClose = candles[candles.length - 1]?.close;

    const overlayRows = Array.isArray(fieldState.overlays) ? (fieldState.overlays as OverlayRow[]) : [];
    const overlays = overlayRows.reduce<VisualizeOverlay[]>((acc, row, index) => {
      if (!row?.data?.trim()) return acc;

      const resolved = resolveReferences(row.data, sourceData, allNodeData);
      const name = row.name?.trim() || `Overlay ${index + 1}`;
      const color = getPaletteColor(index, row.color);
      const id = stableId(row);
      const spec = row.indicatorType && row.indicatorType !== "auto" ? getIndicatorSpec(row.indicatorType) : undefined;

      if (spec) {
        const seriesRows = unwrapSeriesArray(resolved) ?? [];
        if (spec.kind === "bands" && spec.bands) {
          acc.push({
            kind: "bands",
            id,
            name,
            color,
            pane: "price",
            upper: buildChannelSeries(candles, seriesRows, spec.bands.upper),
            middle: spec.bands.middle ? buildChannelSeries(candles, seriesRows, spec.bands.middle) : undefined,
            lower: buildChannelSeries(candles, seriesRows, spec.bands.lower),
          });
          return acc;
        }
        if (spec.kind === "levels" && spec.levels) {
          const latest = seriesRows[seriesRows.length - 1];
          const source = typeof latest === "object" && latest !== null ? (unwrapRow(latest) as Record<string, unknown>) : {};
          const supports = Array.isArray(source[spec.levels.supports]) ? (source[spec.levels.supports] as number[]) : [];
          const resistances = Array.isArray(source[spec.levels.resistances]) ? (source[spec.levels.resistances] as number[]) : [];
          const toFinite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
          acc.push({
            kind: "levels",
            id,
            name,
            supports,
            resistances,
            pivot: toFinite(source.pivot),
            highestHigh: toFinite(source.highest_high ?? source.highestHigh),
            lowestLow: toFinite(source.lowest_low ?? source.lowestLow),
            swingHighsCount: toFinite(source.swing_highs_count ?? source.swingHighsCount),
            swingLowsCount: toFinite(source.swing_lows_count ?? source.swingLowsCount),
            currentClose,
          });
          return acc;
        }
        if (spec.channels?.length) {
          const channels = spec.channels.map((channel, channelIndex) => {
            const points = buildChannelSeries(candles, seriesRows, channel.key, channel.aliases);
            return {
              label: channel.label,
              color: channelIndex === 0 ? color : channel.color,
              style: channel.style ?? "line",
              dashed: channel.dashed,
              data: points,
            };
          });
          if (spec.kind === "line") {
            const primary = channels[0];
            if (primary) {
              acc.push(spec.pane === "panel" ? { kind: "panel", id, name, color: primary.color, data: primary.data } : { kind: "line", id, name, color: primary.color, pane: "price", data: primary.data });
            }
            return acc;
          }
          acc.push({ kind: "multi", id, name, pane: spec.pane, channels, referenceLines: spec.referenceLines });
          return acc;
        }
      }
      const classification = classifyOverlay(name, row.render, resolved, candles);

      if (classification.kind === "bands") {
        acc.push({ kind: "bands", id, name, color, pane: "price", upper: alignSeriesToCandles(candles, classification.upper), middle: classification.middle ? alignSeriesToCandles(candles, classification.middle) : undefined, lower: alignSeriesToCandles(candles, classification.lower) });
        return acc;
      }

      if (classification.kind === "levels") {
        acc.push({ kind: "levels", id, name, supports: classification.supports, resistances: classification.resistances, supportSeries: toHistoricalSeries(candles, classification.supportSeries), resistanceSeries: toHistoricalSeries(candles, classification.resistanceSeries), pivot: classification.pivot, highestHigh: classification.highestHigh, lowestLow: classification.lowestLow, swingHighsCount: classification.swingHighsCount, swingLowsCount: classification.swingLowsCount, currentClose });
        return acc;
      }

      const aligned = alignSeriesToCandles(candles, getSeriesSource(resolved));
      if (classification.kind === "panel") acc.push({ kind: "panel", id, name, color, data: aligned });
      else acc.push({ kind: "line", id, name, color, pane: "price", data: aligned });
      return acc;
    }, []);

    return { candles, overlays, options: { showVolume: true, showLegend: true, autoFit: true } };
  }, [allNodeData, fieldState.candles, fieldState.overlays, sourceData]);

  return <LightweightVisualizeChart viewModel={viewModel} />;
};

export default VisualizeNodePreview;
