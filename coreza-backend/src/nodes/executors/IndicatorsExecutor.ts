import { resultSuccess, resultFailure } from "../../contracts/nodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { IndicatorService, toIndicatorOutput } from "../../nodes/logic/indicators";
import { extractPrices, resolveDataRef } from "../../nodes/logic/toolOutputProcessor";
import { normalizeCandles, candleTimestamp, sameMarketSymbol } from "../../marketData/normalizeCandles";
import { safeToolError, toolInputFields, toolResultSummary } from "../../utils/toolExecutionLog";
import { DataContext, DataContextManager } from "../../engine/DataContext";
import { finalizeNodeResult, createErrorOutput } from "../../utils/nodeResultHelpers";
import {
  IndicatorStateManager,
  buildIndicatorKey,
  isIndicatorStateCompatible,
  requiredWarmupBars,
} from "../../engine";
import { InitializeIndicatorsExecutor } from "./InitializeIndicatorsExecutor";
import { buildExecutionScopedKey } from "../../utils/executionKey";
import { RollingWindow } from "../../engine/RollingWindow";
import {
  buildRollingWindowPayload,
  clampWindowSize,
  normalizeSymbol,
  normalizeTimeframe,
  parseCandleData,
  ROLLING_WINDOW_ERRORS,
  buildRollingWindowNotFoundPayload,
} from "../../engine/rollingWindowHelpers";

export class IndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";
  readonly syncCapable = true;
  private readonly initExecutor = new InitializeIndicatorsExecutor();
  private readonly indicatorKeyCache = new Map<string, string>();
  private readonly rollingWindowKeyCache = new Map<string, string>();
  private readonly rollingWindowResults = new Map<string, NodeResult>();
  private cachedRunId: string | null = null;

  private indicatorType(node: WorkflowNode): string {
    const type = String(node.name || node.node_type || '').trim().toLowerCase();
    return ({ bb: 'bollinger bands', bollinger: 'bollinger bands', stoch: 'stochastic' } as Record<string, string>)[type] ?? type;
  }

  private isPriceIndicator(type: string): boolean {
    return ['ema', 'rsi', 'macd', 'sma', 'bollinger bands'].includes(type);
  }

  private getIndicatorCacheKey(
    nodeId: string,
    symbol: string,
    timeframe: string,
  ): string {
    return `${nodeId}:${symbol}:${timeframe}`;
  }

  execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): NodeResult | Promise<NodeResult> {
    try { return this.executeResolved(node, input, context); }
    catch (error) {
      return createErrorOutput(error, { nodeId: node.id, nodeName: node.name, category: this.category });
    }
  }

  private executeResolved(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): NodeResult | Promise<NodeResult> {
    const runId = context?.runId;
    if (runId && runId !== this.cachedRunId) {
      this.indicatorKeyCache.clear();
      this.rollingWindowKeyCache.clear();
      this.rollingWindowResults.clear();
      this.cachedRunId = runId;
    }

    const indicatorType = this.indicatorType(node);
    if (indicatorType === "initializeindicators") {
      return this.executeAsync(node, input, context);
    }

    if (indicatorType === "rollingwindow") {
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      return this.executeRollingWindowNode(node, resolvedParams, context);
    }

    if (!context?.dataContext || !context?.indicatorStateManager) {
      return this.executeAsync(node, input, context);
    }

    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    const processedParams = this.resolveIndicatorInput(resolvedParams, indicatorType, context);
    const candleData = processedParams.candle_data;
    const dataContext = context?.dataContext as DataContext | undefined;
    if (dataContext && this.canUseState(processedParams)) {
      const stateStart = performance.now();
      const barsData = candleData;

      const stateManager = context?.indicatorStateManager as
        | IndicatorStateManager
        | undefined;
      const userId = context?.userId || context?.user_id;
      const workflowId = context?.workflowId;
      const runId = context?.runId || context?.user_id;
      const symbol = String(processedParams.symbol || "");
      const timeframe = String(processedParams.timeframe || "");

      if (
        stateManager &&
        userId &&
        workflowId &&
        runId &&
        symbol &&
        timeframe &&
        barsData.length > 0
      ) {
        const cacheKey = this.getIndicatorCacheKey(node.id, symbol, timeframe);
        let key = this.indicatorKeyCache.get(cacheKey);
        if (!key) {
          key = buildIndicatorKey(
            userId,
            workflowId,
            runId,
            symbol,
            timeframe,
            node.id,
          );
          this.indicatorKeyCache.set(cacheKey, key);
        }

        let state = stateManager.getStateSync(key);
        // A resolved timeframe can differ from discovery's raw expression.
        // Conditional indicators may also receive their first bar after replay.
        if (
          context?.executionMode === "backtest" &&
          (!state ||
            (context?.isWarmingUp &&
              !isIndicatorStateCompatible(state, indicatorType, processedParams)))
        ) {
          const { candle_data, ...params } = processedParams;
          this.validateDirectCandles(barsData, indicatorType, processedParams);
          state = stateManager.warmUpSync(key, indicatorType, params, barsData);
        }
        if (
          !state ||
          !isIndicatorStateCompatible(state, indicatorType, processedParams)
        ) {
          return createErrorOutput("Indicator state not warmed for sync execution", {
              nodeId: node.id,
              nodeName: node.name,
              category: this.category,
            });
        }

        const latestBar = barsData[barsData.length - 1];
        const latestBarTime = String(
          latestBar?.time ?? latestBar?.t ?? latestBar?.timestamp ?? "",
        );
        if (latestBarTime && latestBarTime !== state.lastBarTime) {
          const newBars = this.newBars(barsData, state.lastBarTime);
          this.validateDirectCandles(newBars, indicatorType, processedParams);
          for (const bar of newBars) state = stateManager.updateSync(key, bar);
        }

        return this.getCachedIndicatorResult(indicatorType, state, context, stateStart);
      }
    }

    return this.executeAsync(node, input, context);
  }

  private async executeAsync(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const runId = context?.runId;
      if (runId && runId !== this.cachedRunId) {
        this.indicatorKeyCache.clear();
        this.rollingWindowKeyCache.clear();
        this.rollingWindowResults.clear();
        this.cachedRunId = runId;
      }
      const indicatorType = this.indicatorType(node);

      // Delegate to InitializeIndicatorsExecutor
      if (indicatorType === "initializeindicators") {
        return this.initExecutor.execute(node, input, {
          ...context,
          indicatorKeyCache: this.indicatorKeyCache,
        });
      }

      if (indicatorType === "rollingwindow") {
        const resolvedParams = context?.resolveNodeParameters
          ? context.resolveNodeParameters(node, input)
          : { ...node.values, ...input };
        return this.executeRollingWindowNode(node, resolvedParams, context);
      }

      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Get DataContext if available (from AI Agent execution)
      const dataContext = context?.dataContext as DataContext | undefined;

      const processedParams = this.resolveIndicatorInput(resolvedParams, indicatorType, context);
      const candleData = processedParams.candle_data;

      if (dataContext && this.canUseState(processedParams)) {
        const stateStart = performance.now();
        const barsData = candleData;

        const stateManager = context?.indicatorStateManager as
          | IndicatorStateManager
          | undefined;
        const userId = context?.userId || context?.user_id;
        const workflowId = context?.workflowId;
        const runId = context?.runId || context?.user_id;
        const symbol = String(processedParams.symbol || "");
        const timeframe = String(processedParams.timeframe || "");

        if (
          stateManager &&
          userId &&
          workflowId &&
          runId &&
          symbol &&
          timeframe &&
          barsData.length > 0
        ) {
          const cacheKey = this.getIndicatorCacheKey(
            node.id,
            symbol,
            timeframe,
          );
          let key = this.indicatorKeyCache.get(cacheKey);
          if (!key) {
            key = buildIndicatorKey(
              userId,
              workflowId,
              runId,
              symbol,
              timeframe,
              node.id,
            );
            this.indicatorKeyCache.set(cacheKey, key);
          }

          const isBacktest = context?.executionMode === "backtest";

          let state;
          if (isBacktest) {
            state = stateManager.getStateSync(key);
            if (
              state &&
              !isIndicatorStateCompatible(state, indicatorType, processedParams)
            ) {
              state = null;
            }
            if (!state) {
              this.validateDirectCandles(barsData, indicatorType, processedParams);
              state = await stateManager.warmUp(
                key,
                indicatorType,
                processedParams,
                barsData,
                true,
              );
            } else {
              const latestBar = barsData[barsData.length - 1];
              const latestBarTime = String(
                latestBar?.time ?? latestBar?.t ?? latestBar?.timestamp ?? "",
              );
              if (latestBarTime && latestBarTime !== state.lastBarTime) {
                const newBars = this.newBars(barsData, state.lastBarTime);
                this.validateDirectCandles(newBars, indicatorType, processedParams);
                for (const bar of newBars) state = stateManager.updateSync(key, bar);
              }
            }
          } else {
            state = await stateManager.getState(key);
            if (
              state &&
              !isIndicatorStateCompatible(state, indicatorType, processedParams)
            ) {
              state = null;
            }
            if (!state) {
              this.validateDirectCandles(barsData, indicatorType, processedParams);
              state = await stateManager.warmUp(
                key,
                indicatorType,
                processedParams,
                barsData,
                false,
              );
            } else {
              const latestBar = barsData[barsData.length - 1];
              const latestBarTime = String(
                latestBar?.time ?? latestBar?.t ?? latestBar?.timestamp ?? "",
              );
              if (latestBarTime && latestBarTime !== state.lastBarTime) {
                const newBars = this.newBars(barsData, state.lastBarTime);
                this.validateDirectCandles(newBars, indicatorType, processedParams);
                for (const bar of newBars) state = await stateManager.update(key, bar, true);
              }
            }
          }

          return this.getCachedIndicatorResult(indicatorType, state, context, stateStart);
        }
      }

      // The service already derives close prices from candles. Map only a configured
      // alternative source, and preserve explicitly supplied prices.
      const priceField = processedParams.price_field ?? processedParams.priceField ?? processedParams.source ?? 'close';
      if (this.isPriceIndicator(indicatorType) && processedParams.prices == null && priceField !== 'close') {
        if (!['open', 'high', 'low'].includes(priceField)) throw new Error('Unsupported indicator price field');
        processedParams.prices = extractPrices(candleData, priceField);
      }
      const observedBars = this.isPriceIndicator(indicatorType) && processedParams.prices != null
        ? (typeof processedParams.prices === 'string' ? JSON.parse(processedParams.prices) : processedParams.prices).length
        : candleData.length;
      const requiredBars = requiredWarmupBars(indicatorType, processedParams);
      const computeStart = performance.now();
      const calculated = await IndicatorService.calculate(
        indicatorType,
        processedParams,
      );
      const computeDuration = performance.now() - computeStart;
      if ((calculated.status === "success") && Array.isArray(calculated.data) && !calculated.data.length && observedBars >= requiredBars) {
        throw new Error('Indicator calculation returned no values');
      }
      if ((calculated.status === "success") && Array.isArray(calculated.data) && calculated.data.length &&
          !this.finiteIndicatorValue(calculated.data.at(-1))) throw new Error('Indicator calculation returned an invalid value');
      const series = Array.isArray(calculated.data) ? calculated.data : undefined;
      const hasVolume = indicatorType !== 'vwap' || !series ||
        candleData.some((bar: any, index: number) => index >= (series.at(-1)?.sessionStart ?? 0) && Number(bar.volume ?? bar.v) > 0);
      const result = (calculated.status === "success") && Array.isArray(calculated.data)
        ? {
            ...calculated,
            data: toIndicatorOutput(indicatorType, {
              currentValue: calculated.data.at(-1), previousValue: calculated.data.at(-2),
              observedBars, isReady: observedBars >= requiredBars && calculated.data.length > 0 && hasVolume,
            }),
            meta: { ...calculated.meta, series: calculated.data, requiredBars },
          }
        : calculated;

      context?.agentDataTrace?.('indicator_compute', () => ({ durationMs: computeDuration, inputRowCount: observedBars,
        observedBars, requiredBars, success: (calculated.status === "success"), result: toolResultSummary(result.data, true) }));
      const normalized = finalizeNodeResult(result, {
        nodeId: node.id,
        nodeName: node.name,
        category: this.category,
        startTime,
      }, "observed");
      return { ...normalized, meta: { ...normalized.meta, requiredBars,
        ...(!hasVolume ? { readinessReason: 'VWAP requires positive volume in the current session' } : {}) } };
    } catch (error) {
      context?.agentDataTrace?.('indicator_error', () => ({ failure: safeToolError(error), success: false }));
      const errOutput = createErrorOutput(
        error instanceof Error
          ? error
          : typeof error === "object" && error !== null
            ? ((error as any).message ?? JSON.stringify(error))
            : String(error),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
        },
      );

      return errOutput;
    }
  }

  private canUseState(params: Record<string, any>): boolean {
    return params.prices == null &&
      (params.price_field ?? params.priceField ?? params.source ?? 'close') === 'close';
  }

  private resolveIndicatorInput(params: Record<string, any>, indicatorType: string, context?: any): Record<string, any> {
    const started = performance.now();
    const logInput = (values: Record<string, any>) => {
      context?.agentDataTrace?.('resolve_candles', () => ({ durationMs: performance.now() - started,
        inputRowCount: values.candle_data?.length || values.prices?.length || 0,
        symbol: values.symbol, timeframe: values.timeframe, dataRef: params.dataRef ||
          (typeof params.candle_data === 'string' && params.candle_data.startsWith('bars:') ? params.candle_data : undefined),
        firstTimestamp: values.candle_data?.[0]?.time,
        lastTimestamp: values.candle_data?.[values.candle_data.length - 1]?.time }));
      context?.agentDataTrace?.('indicator_input', () => ({ indicatorType, fields: toolInputFields(values) }), 'debug');
      return values;
    };
    const resolved = resolveDataRef(params, context?.dataContext, context?.invocationRefs);
    let raw = resolved.candle_data ?? resolved.resolvedData;
    if (typeof raw === 'string') {
      raw = JSON.parse(raw);
      if (raw && typeof raw === 'object' && typeof raw.dataRef === 'string') {
        return this.resolveIndicatorInput({ ...resolved, dataRef: raw.dataRef }, indicatorType, context);
      }
    }
    const priceIndicator = this.isPriceIndicator(indicatorType);
    if (resolved.prices != null && priceIndicator) {
      const prices = typeof resolved.prices === 'string' ? JSON.parse(resolved.prices) : resolved.prices;
      if (!Array.isArray(prices) || !prices.length || prices.some(item => {
        const value = item && typeof item === 'object' ? item.close ?? item.c : item;
        return (typeof value !== 'number' && typeof value !== 'string') ||
          (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value));
      })) {
        throw new Error('Indicator prices must be a non-empty numeric array');
      }
      return logInput({ ...resolved, prices, candle_data: [] });
    }
    const bars = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : null;
    if (!bars || !bars.length) throw new Error('Indicator requires non-empty candle data or prices');
    // Existing numeric candle_data is a supported input to price indicators.
    if (priceIndicator && ['number', 'string'].includes(typeof bars[0])) {
      if (bars.some(bar => !['number', 'string'].includes(typeof bar) || String(bar).trim() === '' || !Number.isFinite(Number(bar)))) {
        throw new Error('Indicator prices must be numeric');
      }
      return logInput({ ...resolved, prices: bars, candle_data: [] });
    }
    let candles;
    if (resolved.resolvedData === bars) {
      candles = bars; // References point to the already normalized historical series.
    } else if (context?.indicatorStateManager && this.canUseState(resolved) &&
        typeof bars[0]?.time === 'number' && typeof bars[0]?.close === 'number') {
      // Upstream live/backtest bars are canonical; incremental updaters validate
      // newly accepted bars. Avoid normalizing/copying a full rolling window.
      this.validateDirectCandles([bars[bars.length - 1]], indicatorType, resolved);
      candles = bars;
    } else {
      this.validateDirectCandles(bars, indicatorType, resolved);
      const first = bars[0];
      const complete = (first.open ?? first.o) != null && (first.high ?? first.h) != null &&
        (first.low ?? first.l) != null && (first.close ?? first.c) != null && (first.volume ?? first.v) != null &&
        (first.time ?? first.timestamp ?? first.t ?? first.date) != null;
      candles = complete ? normalizeCandles(bars) : bars;
    }
    return logInput({ ...resolved, candle_data: candles });
  }

  private validateDirectCandles(bars: any[], indicatorType: string, params: Record<string, any>): void {
    // Preserve existing direct indicator contracts (e.g. ATR needs H/L/C only).
    const priceField = params.price_field ?? params.priceField ?? params.source ?? 'close';
    const fields = this.isPriceIndicator(indicatorType)
      ? [priceField] : indicatorType === 'ichimoku' ? ['high', 'low']
      : indicatorType === 'obv' ? ['close', 'volume']
      : ['volumeoscillator', 'volume-oscillator'].includes(indicatorType) ? ['volume']
      : indicatorType === 'vwap' ? ['high', 'low', 'close', 'volume'] : ['high', 'low', 'close'];
    for (const bar of bars) {
      if (!bar || typeof bar !== 'object' || 'dataRef' in bar) throw new Error('Expected indicator candle data');
      for (const field of fields) {
        const value = bar[field] ?? bar[field[0]];
        if ((typeof value !== 'number' && typeof value !== 'string') ||
            (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) throw new Error(`Missing or invalid candle ${field}`);
      }
      if (bar.symbol && params.symbol && !sameMarketSymbol(bar.symbol, params.symbol, params.asset_type ?? params.assetType)) {
        throw new Error('Candle symbol does not match indicator input');
      }
      const high = Number(bar.high ?? bar.h), low = Number(bar.low ?? bar.l), close = Number(bar.close ?? bar.c);
      if (Number.isFinite(high) && Number.isFinite(low) && (high < low || (Number.isFinite(close) && (close > high || close < low)))) {
        throw new Error('Invalid candle OHLC range');
      }
      if (Number(bar.volume ?? bar.v) < 0) throw new Error('Invalid candle volume');
      const time = bar.time ?? bar.t ?? bar.timestamp;
      if (time != null || indicatorType === 'vwap') candleTimestamp(time, bar.time != null ? 'milliseconds' : 'auto');
    }
  }

  private finiteIndicatorValue(value: any): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (!value || typeof value !== 'object') return false;
    return Object.values(value).every(item => typeof item === 'string' || this.finiteIndicatorValue(item));
  }

  private newBars(bars: any[], lastBarTime: string): any[] {
    const last = Number.isFinite(Number(lastBarTime)) ? Number(lastBarTime) : Date.parse(lastBarTime);
    let start = bars.length;
    while (start > 0) {
      const bar = bars[start - 1];
      const raw = bar.time ?? bar.t ?? bar.timestamp;
      const time = Number.isFinite(Number(raw)) ? Number(raw) : Date.parse(raw);
      if (!Number.isFinite(time) || !Number.isFinite(last)) return bars;
      if (time <= last) break;
      start--;
    }
    return start === 0 ? bars : bars.slice(start);
  }

  private executeRollingWindowNode(
    node: WorkflowNode,
    params: Record<string, any>,
    context?: any,
  ): NodeResult {
    const operation = params.operation ?? "set";
    const requestedSymbol = normalizeSymbol(params.symbol);
    const requestedTimeframe = normalizeTimeframe(params.timeframe);
    if (operation === "get") {
      if (!requestedSymbol) {
        return createErrorOutput(ROLLING_WINDOW_ERRORS.symbolRequired, {
            nodeId: node.id,
            nodeName: "RollingWindow",
            category: this.category,
          });
      }

      if (!requestedTimeframe) {
        return createErrorOutput(ROLLING_WINDOW_ERRORS.timeframeRequired, {
            nodeId: node.id,
            nodeName: "RollingWindow",
            category: this.category,
          });
      }

      const { userId, workflowId, runId, dataContext } =
        this.resolveRollingWindowContext(params, context);
      const rollingCacheKey = `${userId}:${workflowId}:${runId}:${requestedSymbol}:${requestedTimeframe}`;
      let storeKey = this.rollingWindowKeyCache.get(rollingCacheKey);
      if (!storeKey) {
        storeKey = buildExecutionScopedKey({
          userId,
          workflowId,
          runId,
          scope: "rolling_window",
          parts: [requestedSymbol, requestedTimeframe],
        });
        this.rollingWindowKeyCache.set(rollingCacheKey, storeKey);
      }
      const window = dataContext.getDataByKey(storeKey) as
        | RollingWindow<unknown>
        | undefined;

      if (!window) {
        return resultFailure("Node execution failed", { data: buildRollingWindowNotFoundPayload(
            requestedSymbol,
            requestedTimeframe,
          ), meta: {
            key: storeKey,
            timeframe: requestedTimeframe,
          } });
      }

      return resultSuccess(buildRollingWindowPayload(window), { meta: {
          key: storeKey,
          timeframe: requestedTimeframe,
        } });
    }

    const size = clampWindowSize(params.size);
    const symbol = requestedSymbol || "_";
    const timeframe = requestedTimeframe || "_";

    const parsed = parseCandleData(params.candle_data);
    if (!parsed.ok) {
      return createErrorOutput(parsed.error, {
          nodeId: node.id,
          nodeName: "RollingWindow",
          category: this.category,
        });
    }

    const { userId, workflowId, runId, dataContext } =
      this.resolveRollingWindowContext(params, context);
    const rollingCacheKey = `${userId}:${workflowId}:${runId}:${symbol}:${timeframe}`;
    let storeKey = this.rollingWindowKeyCache.get(rollingCacheKey);
    if (!storeKey) {
      storeKey = buildExecutionScopedKey({
        userId,
        workflowId,
        runId,
        scope: "rolling_window",
        parts: [symbol, timeframe],
      });
      this.rollingWindowKeyCache.set(rollingCacheKey, storeKey);
    }

    let window = dataContext.getDataByKey(storeKey) as
      | RollingWindow<unknown>
      | undefined;
    if (!window || window.size !== size) {
      window = new RollingWindow(size);
      dataContext.setData(storeKey, window);
    }

    for (const bar of parsed.bars) {
      window.add(bar);
    }
    const payload = buildRollingWindowPayload(window);
    const rw = this.rollingWindowResults.get(node.id) ?? resultSuccess({});
    Object.assign(rw.data, payload);
    this.rollingWindowResults.set(node.id, rw);
    return rw;
  }

  private resolveRollingWindowContext(
    params: Record<string, any>,
    context?: any,
  ): {
    userId: string;
    workflowId: string;
    runId: string;
    dataContext: DataContext;
  } {
    const userId =
      context?.userId ||
      context?.user_id ||
      params.userId ||
      params.user_id ||
      "system";
    const workflowId =
      context?.workflowId ||
      context?.workflow_id ||
      params.workflowId ||
      params.workflow_id ||
      "manual";
    const runId =
      context?.runId ||
      context?.executionId ||
      params.executionId ||
      params.execution_id ||
      params.run_id ||
      "manual";
    const injectedDataContext = context?.dataContext as DataContext | undefined;
    const dataContext =
      injectedDataContext ??
      DataContextManager.getInstance().getContext({
        executionId: runId,
        workflowId,
        userId,
      });

    return { userId, workflowId, runId, dataContext };
  }

  private extractIndicatorParams(
    params: Record<string, any>,
  ): Record<string, any> {
    const allowedParams = [
      "period",
      "window",
      "fastPeriod",
      "slowPeriod",
      "signalPeriod",
      "stdDev",
      "std_dev_multiplier",
      "k_period",
      "d_period",
      "session_type",
      "custom_start_time",
      "method",
    ];

    return allowedParams.reduce(
      (acc, key) => {
        if (params[key] !== undefined && params[key] !== null) {
          acc[key] = params[key];
        }
        return acc;
      },
      {} as Record<string, any>,
    );
  }

  private getCachedIndicatorResult(
    indicatorType: string,
    state: Parameters<typeof toIndicatorOutput>[1] & { requiredWarmupBars?: number },
    context?: any,
    stateStart?: number,
  ): NodeResult {
    if (state.isReady && !this.finiteIndicatorValue(state.currentValue)) {
      return createErrorOutput('Indicator state contains an invalid value');
    }
    const hasVolume = indicatorType !== 'vwap' || Number(state.internalState?.cumVol) > 0;
    context?.agentDataTrace?.('indicator_readiness', { observedBars: state.observedBars,
      requiredBars: state.requiredWarmupBars, isReady: state.isReady && hasVolume,
      durationMs: stateStart === undefined ? undefined : performance.now() - stateStart });
    return resultSuccess(toIndicatorOutput(indicatorType, { ...state, isReady: state.isReady && hasVolume }), { meta: { requiredBars: state.requiredWarmupBars,
        ...(!hasVolume ? { readinessReason: 'VWAP requires positive volume in the current session' } : {}) } });
  }
}
