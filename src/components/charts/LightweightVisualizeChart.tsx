import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
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
import ChartPaneLegend from "./ChartPaneLegend";

const PRICE_HEIGHT = 320;
const PANEL_HEIGHT = 140;

const toChartTime = (time: number): Time => {
  return (time > 9999999999 ? Math.floor(time / 1000) : time) as Time;
};

type OverlayRegistry = {
  price: Map<string, OverlayHandles>;
  panels: Map<string, { chart: IChartApi; handles: OverlayHandles }>;
};
type PaneLegendValues = Record<string, Record<string, number | null>>;
type LegendState = Record<string, PaneLegendValues>;

type OhlcValues = {
  open: number;
  high: number;
  low: number;
  close: number;
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
type CrosshairSubscription = {
  chart: IChartApi;
  handler: (param: MouseEventParams<Time>) => void;
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
  const rootRef = useRef<HTMLDivElement | null>(null);
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
  const latestLegendValuesRef = useRef<LegendState>({});
  const crosshairSubscriptionsRef = useRef<Map<string, CrosshairSubscription>>(
    new Map(),
  );
  const [legendState, setLegendState] = useState<LegendState>({});
  const [hoveredOhlc, setHoveredOhlc] = useState<OhlcValues | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const cleanupSyncRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.stopPropagation();
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    const onTouch = (event: TouchEvent) => {
      event.stopPropagation();
    };
    node.addEventListener("touchstart", onTouch, { passive: true });
    node.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("touchstart", onTouch);
      node.removeEventListener("touchmove", onTouch);
    };
  }, []);

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
  const priceLegendOverlays = useMemo(
    () => priceOverlays.filter((overlay) => overlay.kind !== "levels"),
    [priceOverlays],
  );
  const latestCandle = viewModel.candles[viewModel.candles.length - 1];

  const buildOverlayLastValues = (
    overlay: VisualizeOverlay,
    handles: OverlayHandles,
  ): Record<string, number | null> => {
    const lastValid = (
      points: Array<{ value: number | null }> | undefined,
    ): number | null => {
      if (!points) return null;
      for (let index = points.length - 1; index >= 0; index -= 1) {
        const point = points[index];
        if (point && point.value !== null) return point.value;
      }
      return null;
    };
    const overlayValues: Record<string, number | null> = {};
    handles.channels.forEach((channel) => {
      if (channel.staticValue !== undefined) {
        overlayValues[channel.key] = channel.staticValue;
        return;
      }
      let value: number | null = null;
      if (overlay.kind === "line" || overlay.kind === "panel") {
        value = lastValid(overlay.data);
      } else if (overlay.kind === "multi") {
        const matched = overlay.channels.find((item) => item.label === channel.key);
        value = lastValid(matched?.data);
      } else if (overlay.kind === "bands") {
        const source =
          channel.key === "upper"
            ? overlay.upper
            : channel.key === "middle"
              ? overlay.middle
              : overlay.lower;
        value = lastValid(source);
      } else if (overlay.kind === "levels") {
        const source =
          channel.key === "support"
            ? overlay.supportSeries
            : overlay.resistanceSeries;
        value = lastValid(source);
      }
      overlayValues[channel.key] = value;
    });
    return overlayValues;
  };

  const bindCrosshairLegend = (
    paneKey: string,
    chart: IChartApi,
    overlays: VisualizeOverlay[],
    resolveHandles: (overlayId: string) => OverlayHandles | undefined,
    candleSeries?: ISeriesApi<"Candlestick", Time> | null,
  ) => {
    const previous = crosshairSubscriptionsRef.current.get(paneKey);
    if (previous) {
      previous.chart.unsubscribeCrosshairMove(previous.handler);
      crosshairSubscriptionsRef.current.delete(paneKey);
    }
    const handler = (param: MouseEventParams<Time>) => {
      const nextPaneValues: PaneLegendValues = {};
      overlays.forEach((overlay) => {
        const handles = resolveHandles(overlay.id);
        if (!handles) return;
        const fallback =
          latestLegendValuesRef.current[paneKey]?.[overlay.id] ?? {};
        const overlayValues: Record<string, number | null> = {};
        handles.channels.forEach((channel) => {
          if (channel.staticValue !== undefined) {
            overlayValues[channel.key] = channel.staticValue;
            return;
          }
          const raw = param.seriesData.get(channel.series);
          const hoveredValue =
            raw && "value" in raw && typeof raw.value === "number"
              ? raw.value
              : null;
          overlayValues[channel.key] =
            param.time !== undefined ? hoveredValue ?? fallback[channel.key] ?? null : fallback[channel.key] ?? null;
        });
        nextPaneValues[overlay.id] = overlayValues;
      });
      if (candleSeries) {
        const candleData = param.seriesData.get(candleSeries);
        if (param.time !== undefined && candleData && "open" in candleData) {
          setHoveredOhlc({
            open: candleData.open,
            high: candleData.high,
            low: candleData.low,
            close: candleData.close,
          });
        } else {
          setHoveredOhlc(null);
        }
      }

      setLegendState((prev) => ({ ...prev, [paneKey]: nextPaneValues }));
    };
    chart.subscribeCrosshairMove(handler);
    crosshairSubscriptionsRef.current.set(paneKey, { chart, handler });
  };

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
      setChartReady(true);
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
    const crosshairSubscriptions = crosshairSubscriptionsRef.current;
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      cleanupSyncRef.current?.();
      cleanupSyncRef.current = null;
      crosshairSubscriptions.forEach(({ chart, handler }) => {
        chart.unsubscribeCrosshairMove(handler);
      });
      crosshairSubscriptions.clear();
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
      setChartReady(false);
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

    const nextLatestLegendValues: LegendState = { ...latestLegendValuesRef.current };
    const nextPriceLegendValues: PaneLegendValues = {};
    priceLegendOverlays.forEach((overlay) => {
      const handles = registryRef.current.price.get(overlay.id);
      if (!handles) return;
      nextPriceLegendValues[overlay.id] = buildOverlayLastValues(overlay, handles);
    });
    nextLatestLegendValues.price = nextPriceLegendValues;

    panelOverlays.forEach((overlay) => {
      const panel = registryRef.current.panels.get(overlay.id);
      if (!panel) return;
      nextLatestLegendValues[overlay.id] = {
        [overlay.id]: buildOverlayLastValues(overlay, panel.handles),
      };
    });

    latestLegendValuesRef.current = nextLatestLegendValues;
    setLegendState((prev) => ({
      ...prev,
      price: nextLatestLegendValues.price ?? {},
      ...panelOverlays.reduce<LegendState>((acc, overlay) => {
        acc[overlay.id] = nextLatestLegendValues[overlay.id] ?? {};
        return acc;
      }, {}),
    }));

    bindCrosshairLegend(
      "price",
      priceChart,
      priceLegendOverlays,
      (overlayId) => registryRef.current.price.get(overlayId),
      candleSeries,
    );
    panelOverlays.forEach((overlay) => {
      const panel = registryRef.current.panels.get(overlay.id);
      if (!panel) return;
      bindCrosshairLegend(overlay.id, panel.chart, [overlay], (overlayId) =>
        registryRef.current.panels.get(overlayId)?.handles,
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
  }, [chartReady, viewModel, panelOverlays, priceLegendOverlays, priceOverlays]);

  return (
    <div
      ref={rootRef}
      className="space-y-2 relative nodrag nowheel"
    >
      <div className="relative">
        <div
          ref={priceRef}
          className="w-full"
          style={{ height: PRICE_HEIGHT, minHeight: PRICE_HEIGHT }}
        />
        <ChartPaneLegend
          overlays={priceLegendOverlays}
          values={legendState.price ?? {}}
          ohlc={
            hoveredOhlc ??
            (latestCandle
              ? {
                  open: latestCandle.open,
                  high: latestCandle.high,
                  low: latestCandle.low,
                  close: latestCandle.close,
                }
              : null)
          }
        />
      </div>
      {panelOverlays.map((overlay) => (
        <div key={overlay.id} className="relative">
          <div
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
          <ChartPaneLegend
            overlays={[overlay]}
            values={legendState[overlay.id] ?? {}}
          />
        </div>
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
