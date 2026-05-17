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
import type {
  CorezaCandle,
  VisualizeChartViewModel,
  VisualizeOverlay,
} from "./chartTypes";
import {
  addOverlaySeries,
  toVolumeData,
  type OverlayHandles,
} from "./lightweightSeriesBuilder";

const PRICE_HEIGHT = 320;
const PANEL_HEIGHT = 140;

const toChartTime = (time: number): Time => {
  return (time > 9999999999 ? Math.floor(time / 1000) : time) as Time;
};

type OverlayRegistry = {
  price: Map<string, OverlayHandles>;
  panel: Map<string, OverlayHandles>;
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

const removeOverlayHandles = (chart: IChartApi, handles: OverlayHandles) => {
  handles.priceLines.forEach(({ anchor, line }) => {
    try {
      anchor.removePriceLine(line);
    } catch {
      /* ignore */
    }
  });
  handles.series.forEach((series) => {
    try {
      chart.removeSeries(series);
    } catch {
      /* ignore */
    }
  });
};

const LightweightVisualizeChart: React.FC<{
  viewModel: VisualizeChartViewModel;
}> = ({ viewModel }) => {
  const priceRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const priceChartRef = useRef<IChartApi | null>(null);
  const panelChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const registryRef = useRef<OverlayRegistry>({
    price: new Map(),
    panel: new Map(),
  });
  const cleanupSyncRef = useRef<(() => void) | null>(null);
  const readyTickRef = useRef(0);

  const panelOverlays = useMemo(
    () =>
      viewModel.overlays.filter(
        (overlay) =>
          overlay.kind === "panel" ||
          (overlay.kind === "multi" && overlay.pane === "panel"),
      ),
    [viewModel.overlays],
  );
  const priceOverlays = useMemo(
    () =>
      viewModel.overlays.filter(
        (overlay) =>
          !(
            overlay.kind === "panel" ||
            (overlay.kind === "multi" && overlay.pane === "panel")
          ),
      ),
    [viewModel.overlays],
  );

  // Initialize the price chart once the container has a non-zero width.
  // Retries via rAF until the container is measured (handles React Flow expand transitions).
  useEffect(() => {
    let cancelled = false;
    let rafId: number | null = null;

    const tryInit = () => {
      if (cancelled) return;
      if (priceChartRef.current) return;
      const container = priceRef.current;
      if (!container || container.clientWidth === 0) {
        rafId = requestAnimationFrame(tryInit);
        return;
      }

      const priceChart = createChart(container, {
        width: container.clientWidth,
        height: PRICE_HEIGHT,
        rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.2 } },
        timeScale: { timeVisible: true, secondsVisible: false },
      });

      const candleSeries = priceChart.addSeries(CandlestickSeries);
      const volumeSeries = priceChart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      volumeSeries
        .priceScale()
        .applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

      priceChartRef.current = priceChart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      // Trigger the data effect now that the chart exists.
      readyTickRef.current += 1;
      // Force a state-less re-render via ref bump by scheduling a microtask.
      // We rely on the data effect's dependency on viewModel; ensure it runs:
      queueMicrotask(() => {
        // no-op; data effect handles next render. We still want the first
        // paint right away, so apply data inline:
        applyData();
      });
    };

    const applyData = () => {
      const priceChart = priceChartRef.current;
      const candleSeries = candleSeriesRef.current;
      const volumeSeries = volumeSeriesRef.current;
      if (!priceChart || !candleSeries || !volumeSeries) return;
      candleSeries.setData(
        viewModel.candles.map((candle: CorezaCandle) => ({
          ...candle,
          time: toChartTime(candle.time),
        })),
      );
      volumeSeries.setData(toVolumeData(viewModel.candles));
      if (viewModel.options.autoFit) {
        priceChart.timeScale().fitContent();
      }
    };

    tryInit();

    const resizeObserver = new ResizeObserver(() => {
      if (priceRef.current && priceChartRef.current) {
        priceChartRef.current.applyOptions({
          width: priceRef.current.clientWidth,
        });
      }
      if (panelRef.current && panelChartRef.current) {
        panelChartRef.current.applyOptions({
          width: panelRef.current.clientWidth,
        });
      }
    });
    if (priceRef.current) resizeObserver.observe(priceRef.current);

    const registry = registryRef.current;
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      cleanupSyncRef.current?.();
      cleanupSyncRef.current = null;
      if (priceChartRef.current) {
        registry.price.forEach((seriesList) =>
          removeOverlayHandles(priceChartRef.current!, seriesList),
        );
        registry.price.clear();
        try {
          priceChartRef.current.remove();
        } catch {
          /* ignore */
        }
      }
      if (panelChartRef.current) {
        registry.panel.forEach((seriesList) =>
          removeOverlayHandles(panelChartRef.current!, seriesList),
        );
        registry.panel.clear();
        try {
          panelChartRef.current.remove();
        } catch {
          /* ignore */
        }
      }
      priceChartRef.current = null;
      panelChartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data + overlays reconciliation
  useEffect(() => {
    const priceChart = priceChartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!priceChart || !candleSeries || !volumeSeries) return;

    candleSeries.setData(
      viewModel.candles.map((candle: CorezaCandle) => ({
        ...candle,
        time: toChartTime(candle.time),
      })),
    );
    volumeSeries.setData(toVolumeData(viewModel.candles));

    const activePriceIds = new Set(priceOverlays.map((overlay) => overlay.id));
    for (const [id, seriesList] of registryRef.current.price.entries()) {
      if (!activePriceIds.has(id)) {
        removeOverlayHandles(priceChart, seriesList);
        registryRef.current.price.delete(id);
      }
    }
    priceOverlays.forEach((overlay: VisualizeOverlay) => {
      const existing = registryRef.current.price.get(overlay.id);
      if (existing) removeOverlayHandles(priceChart, existing);
      const firstCandle = viewModel.candles[0];
      const lastCandle = viewModel.candles[viewModel.candles.length - 1];
      const priceAnchorRange =
        firstCandle && lastCandle
          ? {
              from: toChartTime(firstCandle.time),
              to: toChartTime(lastCandle.time),
            }
          : undefined;
      registryRef.current.price.set(
        overlay.id,
        addOverlaySeries(
          priceChart,
          overlay,
          candleSeriesRef.current ?? undefined,
          priceAnchorRange,
        ),
      );
    });

    if (
      panelOverlays.length > 0 &&
      panelRef.current &&
      !panelChartRef.current
    ) {
      panelChartRef.current = createChart(panelRef.current, {
        width: panelRef.current.clientWidth,
        height: PANEL_HEIGHT,
        timeScale: { timeVisible: true, secondsVisible: false },
      });
      cleanupSyncRef.current = syncTimeScales(
        priceChart,
        panelChartRef.current,
      );
    }

    if (panelChartRef.current) {
      const activePanelIds = new Set(
        panelOverlays.map((overlay) => overlay.id),
      );
      for (const [id, seriesList] of registryRef.current.panel.entries()) {
        if (!activePanelIds.has(id)) {
          removeOverlayHandles(panelChartRef.current, seriesList);
          registryRef.current.panel.delete(id);
        }
      }
      panelOverlays.forEach((overlay) => {
        const existing = registryRef.current.panel.get(overlay.id);
        if (existing) removeOverlayHandles(panelChartRef.current!, existing);
        registryRef.current.panel.set(
          overlay.id,
          addOverlaySeries(panelChartRef.current!, overlay),
        );
      });

      if (panelOverlays.length === 0) {
        cleanupSyncRef.current?.();
        cleanupSyncRef.current = null;
        try {
          panelChartRef.current.remove();
        } catch {
          /* ignore */
        }
        panelChartRef.current = null;
      }
    }

    if (viewModel.options.autoFit) {
      priceChart.timeScale().fitContent();
      panelChartRef.current?.timeScale().fitContent();
    }
  }, [viewModel, panelOverlays, priceOverlays]);

  return (
    <div className="space-y-2 relative">
      <div
        ref={priceRef}
        className="w-full"
        style={{ height: PRICE_HEIGHT, minHeight: PRICE_HEIGHT }}
      />
      {panelOverlays.length > 0 && (
        <div
          ref={panelRef}
          className="w-full"
          style={{ height: PANEL_HEIGHT, minHeight: PANEL_HEIGHT }}
        />
      )}
      {viewModel.candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none">
          No candle data
        </div>
      )}
    </div>
  );
};

export default LightweightVisualizeChart;
