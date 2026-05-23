export type UTCTimestamp = number;

export type CorezaCandle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type AlignedSeriesPoint = { time: UTCTimestamp; value: number | null };
export type ChartSeriesPoint = { time: UTCTimestamp; value: number };
export type SeriesPoint = AlignedSeriesPoint;

export type VisualizeOverlay =
  | {
      kind: "line";
      id: string;
      name: string;
      color: string;
      pane: "price";
      data: SeriesPoint[];
    }
  | {
      kind: "bands";
      id: string;
      name: string;
      color: string;
      pane: "price";
      upper: SeriesPoint[];
      middle?: SeriesPoint[];
      lower: SeriesPoint[];
    }
  | {
      kind: "levels";
      id: string;
      name: string;
      supports: number[];
      resistances: number[];
      supportSeries?: SeriesPoint[];
      resistanceSeries?: SeriesPoint[];
      pivot?: number | null;
      currentClose?: number;
    }
  | {
      kind: "panel";
      id: string;
      name: string;
      color: string;
      data: SeriesPoint[];
    }
  | {
      kind: "multi";
      id: string;
      name: string;
      pane: "price" | "panel";
      channels: Array<{
        label: string;
        color: string;
        style: "line" | "histogram";
        dashed?: boolean;
        data: SeriesPoint[];
      }>;
      referenceLines?: Array<{ price: number; color: string; label?: string }>;
    };

export type VisualizeChartViewModel = {
  candles: CorezaCandle[];
  overlays: VisualizeOverlay[];
  options: { showVolume: boolean; showLegend: boolean; autoFit: boolean };
};
