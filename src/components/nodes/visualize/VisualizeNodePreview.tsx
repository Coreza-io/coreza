import React, { useMemo } from "react";
import LightweightVisualizeChart from "@/components/charts/LightweightVisualizeChart";
import type { SeriesPoint, VisualizeChartViewModel, VisualizeOverlay } from "@/components/charts/chartTypes";
import { resolveReferences } from "@/utils/resolveReferences";
import { alignSeriesToCandles, classifyOverlay, extractBars, getPaletteColor } from "@/utils/visualizeNormalize";

type OverlayRow = { id?: string; name?: string; data?: string; render?: string; color?: string };

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
      const classification = classifyOverlay(name, row.render, resolved, candles);

      if (classification.kind === "bands") {
        acc.push({ kind: "bands", id, name, color, pane: "price", upper: alignSeriesToCandles(candles, classification.upper), middle: classification.middle ? alignSeriesToCandles(candles, classification.middle) : undefined, lower: alignSeriesToCandles(candles, classification.lower) });
        return acc;
      }

      if (classification.kind === "levels") {
        acc.push({ kind: "levels", id, name, supports: classification.supports, resistances: classification.resistances, supportSeries: toHistoricalSeries(candles, classification.supportSeries), resistanceSeries: toHistoricalSeries(candles, classification.resistanceSeries), currentClose });
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
