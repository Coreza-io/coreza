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
  panels: Map<string, { chart: IChartApi; handles: OverlayHandles }>;
};

const syncTimeScales = (charts: IChartApi[]): (() => void) => {
  let syncing = false;
  const unsubscribers = charts.map((chart, sourceIndex) => {
    const onRangeChange = (range: LogicalRange | null) => {
      if (!range || syncing) return;
      syncing = true;
      charts.forEach((targetChart, targetIndex) => {
        if (targetIndex !== sourceIndex) {
          targetChart.timeScale().setVisibleLogicalRange(range);
        }
      });
      syncing = false;
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
    };
  });
  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
};

type PanelChartEntry = {
  container: HTMLDivElement;
  chart: IChartApi;
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
  const panelContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const priceChartRef = useRef<IChartApi | null>(null);
  const panelChartsRef = useRef<Map<string, PanelChartEntry>>(new Map());
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram", Time> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const registryRef = useRef<OverlayRegistry>({
    price: new Map(),
    panels: new Map(),
  });
  const cleanupSyncRef = useRef<(() => void) | null>(null);

  const isPanelOverlay = (overlay: VisualizeOverlay): boolean =>
    overlay.kind === "panel" ||
    (overlay.kind === "multi" && overlay.pane === "panel");

  const panelOverlays = useMemo(
    () => viewModel.overlays.filter(isPanelOverlay),
    [viewModel.overlays],
  );
  const priceOverlays = useMemo(
    () => viewModel.overlays.filter((overlay) => !isPanelOverlay(overlay)),
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
      panelChartsRef.current.forEach(({ chart, container }) => {
        chart.applyOptions({ width: container.clientWidth });
      });
    });
    resizeObserverRef.current = resizeObserver;
    if (priceRef.current) resizeObserver.observe(priceRef.current);
    panelContainerRefs.current.forEach((container) =>
      resizeObserver.observe(container),
    );

    const registry = registryRef.current;
    const panelCharts = panelChartsRef.current;
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
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
      registry.panels.forEach(({ chart, handles }) => {
        removeOverlayHandles(chart, handles);
      });
      registry.panels.clear();
      panelCharts.forEach(({ chart }) => {
        try {
          chart.remove();
        } catch {
          /* ignore */
        }
      });
      panelCharts.clear();
      priceChartRef.current = null;
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

    const activePanelIds = new Set(panelOverlays.map((overlay) => overlay.id));
    for (const [id, panelEntry] of panelChartsRef.current.entries()) {
      if (!activePanelIds.has(id)) {
        const panel = registryRef.current.panels.get(id);
        if (panel) {
          removeOverlayHandles(panel.chart, panel.handles);
          registryRef.current.panels.delete(id);
        }
        try {
          panelEntry.chart.remove();
        } catch {
          /* ignore */
        }
        panelChartsRef.current.delete(id);
      }
    }

    panelOverlays.forEach((overlay) => {
      const container = panelContainerRefs.current.get(overlay.id);
      if (!container) return;
      let panelEntry = panelChartsRef.current.get(overlay.id);
      if (!panelEntry) {
        const panelChart = createChart(container, {
          width: container.clientWidth,
          height: PANEL_HEIGHT,
          timeScale: { timeVisible: true, secondsVisible: false },
        });
        panelEntry = { container, chart: panelChart };
        panelChartsRef.current.set(overlay.id, panelEntry);
      }

      const existing = registryRef.current.panels.get(overlay.id);
      if (existing) removeOverlayHandles(existing.chart, existing.handles);
      registryRef.current.panels.set(
        overlay.id,
        {
          chart: panelEntry.chart,
          handles: addOverlaySeries(panelEntry.chart, overlay),
        },
      );
    });

    cleanupSyncRef.current?.();
    cleanupSyncRef.current = syncTimeScales([
      priceChart,
      ...panelOverlays
        .map((overlay) => panelChartsRef.current.get(overlay.id)?.chart)
        .filter((chart): chart is IChartApi => Boolean(chart)),
    ]);

    if (viewModel.options.autoFit) {
      priceChart.timeScale().fitContent();
      panelOverlays.forEach((overlay) => {
        panelChartsRef.current.get(overlay.id)?.chart.timeScale().fitContent();
      });
    }
  }, [viewModel, panelOverlays, priceOverlays]);

  return (
    <div className="space-y-2 relative">
      <div
        ref={priceRef}
        className="w-full"
        style={{ height: PRICE_HEIGHT, minHeight: PRICE_HEIGHT }}
      />
      {panelOverlays.map((overlay) => (
        <div
          key={overlay.id}
          ref={(node) => {
            if (node) {
              panelContainerRefs.current.set(overlay.id, node);
              resizeObserverRef.current?.observe(node);
            } else {
              const container = panelContainerRefs.current.get(overlay.id);
              if (container) {
                resizeObserverRef.current?.unobserve(container);
              }
              panelContainerRefs.current.delete(overlay.id);
            }
          }}
          className="w-full"
          style={{ height: PANEL_HEIGHT, minHeight: PANEL_HEIGHT }}
        />
      ))}
      {viewModel.candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none">
          No candle data
        </div>
      )}
    </div>
  );
};

export default LightweightVisualizeChart;
