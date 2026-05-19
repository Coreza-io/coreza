import React from "react";
import type { VisualizeOverlay } from "./chartTypes";

type ChannelValues = Record<string, number | null>;
type LegendValues = Record<string, ChannelValues>;
type OhlcValues = {
  open: number;
  high: number;
  low: number;
  close: number;
};

const formatAbbrev = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toString();
};

const formatNumber = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1000) return formatAbbrev(value);
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3);
  return value.toFixed(4);
};

const overlayColor = (overlay: VisualizeOverlay): string => {
  if ("color" in overlay) return overlay.color;
  if (overlay.kind === "levels") return "#22c55e";
  return "#94a3b8";
};

const channelColor = (
  overlay: VisualizeOverlay,
  channelKey: string,
): string => {
  if (overlay.kind === "multi") {
    return (
      overlay.channels.find((channel) => channel.label === channelKey)?.color ??
      overlayColor(overlay)
    );
  }
  if (overlay.kind === "levels") {
    if (channelKey === "support") return "#22c55e";
    if (channelKey === "resistance") return "#ef4444";
  }
  return overlayColor(overlay);
};

const ChartPaneLegend: React.FC<{
  overlays: VisualizeOverlay[];
  values: LegendValues;
  ohlc?: OhlcValues | null;
}> = ({ overlays, values, ohlc }) => {
  if (overlays.length === 0 && !ohlc) return null;
  return (
    <div className="absolute top-2 left-2 z-10 pointer-events-none rounded bg-slate-900/60 px-2 py-1 text-[11px] leading-5 text-slate-100 backdrop-blur-sm">
      {ohlc && (
        <div className="mb-0.5 flex items-center gap-2 font-mono text-slate-200">
          <span>O {formatNumber(ohlc.open)}</span>
          <span>H {formatNumber(ohlc.high)}</span>
          <span>L {formatNumber(ohlc.low)}</span>
          <span>C {formatNumber(ohlc.close)}</span>
        </div>
      )}
      {overlays.map((overlay) => {
        const channelValues = values[overlay.id] ?? {};
        const entries = Object.entries(channelValues);
        return (
          <div key={overlay.id} className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium text-slate-200">{overlay.name}</span>
            {entries.map(([key, value]) => (
              <span key={key} className="font-mono text-slate-100">
                <span
                  className="mr-1 inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: channelColor(overlay, key) }}
                />
                {key} {formatNumber(value)}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default ChartPaneLegend;
