import React, { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type Time,
} from "lightweight-charts";
import type { CorezaCandle, VisualizeChartViewModel, VisualizeOverlay } from "./chartTypes";
import { addOverlaySeries, toVolumeData } from "./lightweightSeriesBuilder";

const PRICE_HEIGHT = 320;
const PANEL_HEIGHT = 140;

type OverlayRegistry = {
  price: Map<string, ISeriesApi<any, Time>[]>;
  panel: Map<string, ISeriesApi<any, Time>[]>;
};

const syncTimeScales = (first: IChartApi, second: IChartApi): (() => void) => {
  let syncing = false;

  const fromFirst = (range: LogicalRange | null) => {
    if (!range || syncing) return;
    syncing = true;
    second.timeScale().setVisibleLogicalRange(range);
    syncing = false;
  };

  const fromSecond = (range: LogicalRange | null) => {
    if (!range || syncing) return;
    syncing = true;
    first.timeScale().setVisibleLogicalRange(range);
    syncing = false;
  };

  first.timeScale().subscribeVisibleLogicalRangeChange(fromFirst);
  second.timeScale().subscribeVisibleLogicalRangeChange(fromSecond);

  return () => {
    first.timeScale().unsubscribeVisibleLogicalRangeChange(fromFirst);
    second.timeScale().unsubscribeVisibleLogicalRangeChange(fromSecond);
  };
};

const removeSeriesList = (chart: IChartApi, list: ISeriesApi<any, Time>[]) => {
  list.forEach((series) => chart.removeSeries(series));
};

const LightweightVisualizeChart: React.FC<{ viewModel: VisualizeChartViewModel }> = ({ viewModel }) => {
  const priceRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const panelChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const registryRef = useRef<OverlayRegistry>({ price: new Map(), panel: new Map() });
  const cleanupSyncRef = useRef<(() => void) | null>(null);

  const panelOverlays = useMemo(
    () => viewModel.overlays.filter((overlay) => overlay.kind === "panel"),
    [viewModel.overlays],
  );
  const priceOverlays = useMemo(
    () => viewModel.overlays.filter((overlay) => overlay.kind !== "panel"),
    [viewModel.overlays],
  );

  useEffect(() => {
    if (!priceRef.current || priceChartRef.current) return;

    const priceChart = createChart(priceRef.current, {
      width: priceRef.current.clientWidth,
      height: PRICE_HEIGHT,
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.2 } },
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const candleSeries = priceChart.addSeries(CandlestickSeries);
    const volumeSeries = priceChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    priceChartRef.current = priceChart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (priceRef.current && priceChartRef.current) {
        priceChartRef.current.applyOptions({ width: priceRef.current.clientWidth });
      }
      if (panelRef.current && panelChartRef.current) {
        panelChartRef.current.applyOptions({ width: panelRef.current.clientWidth });
      }
    });

    resizeObserver.observe(priceRef.current);
    if (panelRef.current) resizeObserver.observe(panelRef.current);

    return () => {
      resizeObserver.disconnect();
      cleanupSyncRef.current?.();
      if (priceChartRef.current) {
        registryRef.current.price.forEach((seriesList) => removeSeriesList(priceChartRef.current as IChartApi, seriesList));
        registryRef.current.price.clear();
        priceChartRef.current.remove();
      }
      if (panelChartRef.current) {
        registryRef.current.panel.forEach((seriesList) => removeSeriesList(panelChartRef.current as IChartApi, seriesList));
        registryRef.current.panel.clear();
        panelChartRef.current.remove();
      }
    };
  }, []);

  useEffect(() => {
    const priceChart = priceChartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!priceChart || !candleSeries || !volumeSeries) return;

    candleSeries.setData(viewModel.candles.map((candle: CorezaCandle) => ({ ...candle, time: candle.time as Time })));
    volumeSeries.setData(toVolumeData(viewModel.candles));

    // reconcile price overlays
    const activePriceIds = new Set(priceOverlays.map((overlay) => overlay.id));
    for (const [id, seriesList] of registryRef.current.price.entries()) {
      if (!activePriceIds.has(id)) {
        removeSeriesList(priceChart, seriesList);
        registryRef.current.price.delete(id);
      }
    }
    priceOverlays.forEach((overlay: VisualizeOverlay) => {
      const existing = registryRef.current.price.get(overlay.id);
      if (existing) removeSeriesList(priceChart, existing);
      registryRef.current.price.set(overlay.id, addOverlaySeries(priceChart as any, overlay) as unknown as ISeriesApi<any, Time>[]);
    });

    // panel chart lifecycle + reconcile
    if (panelOverlays.length > 0 && panelRef.current && !panelChartRef.current) {
      panelChartRef.current = createChart(panelRef.current, {
        width: panelRef.current.clientWidth,
        height: PANEL_HEIGHT,
        timeScale: { timeVisible: true, secondsVisible: false },
      });
      cleanupSyncRef.current = syncTimeScales(priceChart, panelChartRef.current);
    }

    if (panelChartRef.current) {
      const activePanelIds = new Set(panelOverlays.map((overlay) => overlay.id));
      for (const [id, seriesList] of registryRef.current.panel.entries()) {
        if (!activePanelIds.has(id)) {
          removeSeriesList(panelChartRef.current, seriesList);
          registryRef.current.panel.delete(id);
        }
      }
      panelOverlays.forEach((overlay) => {
        const existing = registryRef.current.panel.get(overlay.id);
        if (existing) removeSeriesList(panelChartRef.current as IChartApi, existing);
        registryRef.current.panel.set(overlay.id, addOverlaySeries(panelChartRef.current as any, overlay) as unknown as ISeriesApi<any, Time>[]);
      });

      if (panelOverlays.length === 0) {
        cleanupSyncRef.current?.();
        cleanupSyncRef.current = null;
        panelChartRef.current.remove();
        panelChartRef.current = null;
      }
    }

    if (viewModel.options.autoFit) {
      priceChart.timeScale().fitContent();
      panelChartRef.current?.timeScale().fitContent();
    }
  }, [viewModel, panelOverlays, priceOverlays]);

  if (viewModel.candles.length === 0) {
    return <div className="text-gray-500 text-sm py-8 text-center">No candle data</div>;
  }

  return (
    <div className="space-y-2">
      <div ref={priceRef} className="w-full" />
      {panelOverlays.length > 0 && <div ref={panelRef} className="w-full" />}
    </div>
  );
};

export default LightweightVisualizeChart;
