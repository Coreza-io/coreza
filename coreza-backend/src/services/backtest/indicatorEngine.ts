/**
 * Fast Indicator Engine
 * O(1) incremental indicator updates for high-performance backtesting
 */

import { Bar, IndicatorDef, IndicatorType } from './strategyIR';

// ============= Indicator State Types =============

export interface RSIState {
  period: number;
  gains: number[];
  losses: number[];
  avgGain: number;
  avgLoss: number;
  value: number | null;
  prevClose: number | null;
  count: number;
  ready: boolean;
}

export interface EMAState {
  period: number;
  multiplier: number;
  value: number | null;
  count: number;
  ready: boolean;
}

export interface SMAState {
  period: number;
  values: number[];
  sum: number;
  value: number | null;
  count: number;
  ready: boolean;
}

export interface MACDState {
  fastEMA: EMAState;
  slowEMA: EMAState;
  signalEMA: EMAState;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  ready: boolean;
}

export interface BBState {
  period: number;
  stdDev: number;
  sma: SMAState;
  values: number[];
  upper: number | null;
  middle: number | null;
  lower: number | null;
  width: number | null;
  ready: boolean;
}

export interface StochState {
  kPeriod: number;
  dPeriod: number;
  highs: number[];
  lows: number[];
  closes: number[];
  kValues: number[];
  k: number | null;
  d: number | null;
  count: number;
  ready: boolean;
}

export interface VWAPState {
  cumulativeTPV: number;  // Cumulative (Typical Price * Volume)
  cumulativeVolume: number;
  value: number | null;
  ready: boolean;
}

export interface ADXState {
  period: number;
  trueRanges: number[];
  plusDMs: number[];
  minusDMs: number[];
  prevHigh: number | null;
  prevLow: number | null;
  prevClose: number | null;
  atr: number | null;
  plusDI: number | null;
  minusDI: number | null;
  adx: number | null;
  dxValues: number[];
  count: number;
  ready: boolean;
}

export interface OBVState {
  value: number;
  prevClose: number | null;
  ready: boolean;
}

export interface ATRState {
  period: number;
  trueRanges: number[];
  value: number | null;
  prevClose: number | null;
  count: number;
  ready: boolean;
}

export type IndicatorState = 
  | { type: 'RSI'; state: RSIState }
  | { type: 'EMA'; state: EMAState }
  | { type: 'SMA'; state: SMAState }
  | { type: 'MACD'; state: MACDState }
  | { type: 'BB'; state: BBState }
  | { type: 'STOCH'; state: StochState }
  | { type: 'VWAP'; state: VWAPState }
  | { type: 'ADX'; state: ADXState }
  | { type: 'OBV'; state: OBVState }
  | { type: 'ATR'; state: ATRState };

// ============= Factory Functions =============

export function createRSI(period: number): RSIState {
  return {
    period,
    gains: [],
    losses: [],
    avgGain: 0,
    avgLoss: 0,
    value: null,
    prevClose: null,
    count: 0,
    ready: false
  };
}

export function createEMA(period: number): EMAState {
  return {
    period,
    multiplier: 2 / (period + 1),
    value: null,
    count: 0,
    ready: false
  };
}

export function createSMA(period: number): SMAState {
  return {
    period,
    values: [],
    sum: 0,
    value: null,
    count: 0,
    ready: false
  };
}

export function createMACD(fastPeriod: number, slowPeriod: number, signalPeriod: number): MACDState {
  return {
    fastEMA: createEMA(fastPeriod),
    slowEMA: createEMA(slowPeriod),
    signalEMA: createEMA(signalPeriod),
    macd: null,
    signal: null,
    histogram: null,
    ready: false
  };
}

export function createBB(period: number, stdDev: number): BBState {
  return {
    period,
    stdDev,
    sma: createSMA(period),
    values: [],
    upper: null,
    middle: null,
    lower: null,
    width: null,
    ready: false
  };
}

export function createStoch(kPeriod: number, dPeriod: number): StochState {
  return {
    kPeriod,
    dPeriod,
    highs: [],
    lows: [],
    closes: [],
    kValues: [],
    k: null,
    d: null,
    count: 0,
    ready: false
  };
}

export function createVWAP(): VWAPState {
  return {
    cumulativeTPV: 0,
    cumulativeVolume: 0,
    value: null,
    ready: false
  };
}

export function createADX(period: number): ADXState {
  return {
    period,
    trueRanges: [],
    plusDMs: [],
    minusDMs: [],
    prevHigh: null,
    prevLow: null,
    prevClose: null,
    atr: null,
    plusDI: null,
    minusDI: null,
    adx: null,
    dxValues: [],
    count: 0,
    ready: false
  };
}

export function createOBV(): OBVState {
  return {
    value: 0,
    prevClose: null,
    ready: false
  };
}

export function createATR(period: number): ATRState {
  return {
    period,
    trueRanges: [],
    value: null,
    prevClose: null,
    count: 0,
    ready: false
  };
}

// ============= Update Functions (O(1) operations) =============

export function updateRSI(state: RSIState, close: number): void {
  if (state.prevClose === null) {
    state.prevClose = close;
    return;
  }

  const change = close - state.prevClose;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;

  state.count++;

  if (state.count <= state.period) {
    state.gains.push(gain);
    state.losses.push(loss);
    
    if (state.count === state.period) {
      state.avgGain = state.gains.reduce((a, b) => a + b, 0) / state.period;
      state.avgLoss = state.losses.reduce((a, b) => a + b, 0) / state.period;
      state.ready = true;
    }
  } else {
    // Wilder's smoothing
    state.avgGain = (state.avgGain * (state.period - 1) + gain) / state.period;
    state.avgLoss = (state.avgLoss * (state.period - 1) + loss) / state.period;
  }

  if (state.ready) {
    if (state.avgLoss === 0) {
      state.value = 100;
    } else {
      const rs = state.avgGain / state.avgLoss;
      state.value = 100 - (100 / (1 + rs));
    }
  }

  state.prevClose = close;
}

export function updateEMA(state: EMAState, value: number): void {
  state.count++;
  
  if (state.value === null) {
    state.value = value;
  } else {
    state.value = (value - state.value) * state.multiplier + state.value;
  }
  
  if (state.count >= state.period) {
    state.ready = true;
  }
}

export function updateSMA(state: SMAState, value: number): void {
  state.count++;
  state.values.push(value);
  state.sum += value;
  
  if (state.values.length > state.period) {
    state.sum -= state.values.shift()!;
  }
  
  if (state.values.length >= state.period) {
    state.value = state.sum / state.period;
    state.ready = true;
  }
}

export function updateMACD(state: MACDState, close: number): void {
  updateEMA(state.fastEMA, close);
  updateEMA(state.slowEMA, close);
  
  if (state.fastEMA.ready && state.slowEMA.ready) {
    state.macd = state.fastEMA.value! - state.slowEMA.value!;
    updateEMA(state.signalEMA, state.macd);
    
    if (state.signalEMA.ready) {
      state.signal = state.signalEMA.value;
      state.histogram = state.macd - state.signal!;
      state.ready = true;
    }
  }
}

export function updateBB(state: BBState, close: number): void {
  updateSMA(state.sma, close);
  state.values.push(close);
  
  if (state.values.length > state.period) {
    state.values.shift();
  }
  
  if (state.sma.ready && state.values.length >= state.period) {
    const mean = state.sma.value!;
    const squaredDiffs = state.values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / state.period;
    const std = Math.sqrt(variance);
    
    state.middle = mean;
    state.upper = mean + (state.stdDev * std);
    state.lower = mean - (state.stdDev * std);
    state.width = (state.upper - state.lower) / state.middle;
    state.ready = true;
  }
}

export function updateStoch(state: StochState, bar: Bar): void {
  state.highs.push(bar.h);
  state.lows.push(bar.l);
  state.closes.push(bar.c);
  state.count++;
  
  if (state.highs.length > state.kPeriod) {
    state.highs.shift();
    state.lows.shift();
    state.closes.shift();
  }
  
  if (state.count >= state.kPeriod) {
    const highestHigh = Math.max(...state.highs);
    const lowestLow = Math.min(...state.lows);
    const currentClose = bar.c;
    
    const range = highestHigh - lowestLow;
    state.k = range === 0 ? 50 : ((currentClose - lowestLow) / range) * 100;
    
    state.kValues.push(state.k);
    if (state.kValues.length > state.dPeriod) {
      state.kValues.shift();
    }
    
    if (state.kValues.length >= state.dPeriod) {
      state.d = state.kValues.reduce((a, b) => a + b, 0) / state.dPeriod;
      state.ready = true;
    }
  }
}

export function updateVWAP(state: VWAPState, bar: Bar): void {
  const typicalPrice = (bar.h + bar.l + bar.c) / 3;
  state.cumulativeTPV += typicalPrice * bar.v;
  state.cumulativeVolume += bar.v;
  
  if (state.cumulativeVolume > 0) {
    state.value = state.cumulativeTPV / state.cumulativeVolume;
    state.ready = true;
  }
}

export function updateADX(state: ADXState, bar: Bar): void {
  if (state.prevHigh === null || state.prevLow === null || state.prevClose === null) {
    state.prevHigh = bar.h;
    state.prevLow = bar.l;
    state.prevClose = bar.c;
    return;
  }

  // True Range
  const tr = Math.max(
    bar.h - bar.l,
    Math.abs(bar.h - state.prevClose),
    Math.abs(bar.l - state.prevClose)
  );
  
  // Directional Movement
  const upMove = bar.h - state.prevHigh;
  const downMove = state.prevLow - bar.l;
  
  const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
  const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
  
  state.trueRanges.push(tr);
  state.plusDMs.push(plusDM);
  state.minusDMs.push(minusDM);
  state.count++;
  
  if (state.trueRanges.length > state.period) {
    state.trueRanges.shift();
    state.plusDMs.shift();
    state.minusDMs.shift();
  }
  
  if (state.count >= state.period) {
    const atr = state.trueRanges.reduce((a, b) => a + b, 0) / state.period;
    const plusDI = atr > 0 ? (state.plusDMs.reduce((a, b) => a + b, 0) / state.period / atr) * 100 : 0;
    const minusDI = atr > 0 ? (state.minusDMs.reduce((a, b) => a + b, 0) / state.period / atr) * 100 : 0;
    
    state.atr = atr;
    state.plusDI = plusDI;
    state.minusDI = minusDI;
    
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    
    state.dxValues.push(dx);
    if (state.dxValues.length > state.period) {
      state.dxValues.shift();
    }
    
    if (state.dxValues.length >= state.period) {
      state.adx = state.dxValues.reduce((a, b) => a + b, 0) / state.period;
      state.ready = true;
    }
  }
  
  state.prevHigh = bar.h;
  state.prevLow = bar.l;
  state.prevClose = bar.c;
}

export function updateOBV(state: OBVState, bar: Bar): void {
  if (state.prevClose === null) {
    state.prevClose = bar.c;
    state.ready = true;
    return;
  }
  
  if (bar.c > state.prevClose) {
    state.value += bar.v;
  } else if (bar.c < state.prevClose) {
    state.value -= bar.v;
  }
  
  state.prevClose = bar.c;
}

export function updateATR(state: ATRState, bar: Bar): void {
  if (state.prevClose === null) {
    state.prevClose = bar.c;
    return;
  }

  const tr = Math.max(
    bar.h - bar.l,
    Math.abs(bar.h - state.prevClose),
    Math.abs(bar.l - state.prevClose)
  );
  
  state.trueRanges.push(tr);
  state.count++;
  
  if (state.trueRanges.length > state.period) {
    state.trueRanges.shift();
  }
  
  if (state.count >= state.period) {
    state.value = state.trueRanges.reduce((a, b) => a + b, 0) / state.period;
    state.ready = true;
  }
  
  state.prevClose = bar.c;
}

// ============= Indicator Context =============

export interface IndicatorContext {
  indicators: Map<string, IndicatorState>;
  prevValues: Map<string, number>;  // For crossover detection
}

export function createIndicatorContext(): IndicatorContext {
  return {
    indicators: new Map(),
    prevValues: new Map()
  };
}

export function initializeIndicators(ctx: IndicatorContext, defs: IndicatorDef[]): void {
  for (const def of defs) {
    let state: IndicatorState;
    
    switch (def.type) {
      case 'RSI':
        state = { type: 'RSI', state: createRSI(def.params.period || 14) };
        break;
      case 'EMA':
        state = { type: 'EMA', state: createEMA(def.params.period || 20) };
        break;
      case 'SMA':
        state = { type: 'SMA', state: createSMA(def.params.period || 20) };
        break;
      case 'MACD':
        state = { type: 'MACD', state: createMACD(
          def.params.fastPeriod || 12,
          def.params.slowPeriod || 26,
          def.params.signalPeriod || 9
        )};
        break;
      case 'BB':
        state = { type: 'BB', state: createBB(def.params.period || 20, def.params.stdDev || 2) };
        break;
      case 'STOCH':
        state = { type: 'STOCH', state: createStoch(def.params.kPeriod || 14, def.params.dPeriod || 3) };
        break;
      case 'VWAP':
        state = { type: 'VWAP', state: createVWAP() };
        break;
      case 'ADX':
        state = { type: 'ADX', state: createADX(def.params.period || 14) };
        break;
      case 'OBV':
        state = { type: 'OBV', state: createOBV() };
        break;
      case 'ATR':
        state = { type: 'ATR', state: createATR(def.params.period || 14) };
        break;
      default:
        continue;
    }
    
    ctx.indicators.set(def.id, state);
  }
}

export function updateAllIndicators(ctx: IndicatorContext, bar: Bar): void {
  for (const [id, indicator] of ctx.indicators) {
    // Store previous value for crossover detection
    const prevValue = getIndicatorValue(indicator);
    if (prevValue !== null) {
      ctx.prevValues.set(id, prevValue);
    }
    
    switch (indicator.type) {
      case 'RSI':
        updateRSI(indicator.state, bar.c);
        break;
      case 'EMA':
        updateEMA(indicator.state, bar.c);
        break;
      case 'SMA':
        updateSMA(indicator.state, bar.c);
        break;
      case 'MACD':
        updateMACD(indicator.state, bar.c);
        break;
      case 'BB':
        updateBB(indicator.state, bar.c);
        break;
      case 'STOCH':
        updateStoch(indicator.state, bar);
        break;
      case 'VWAP':
        updateVWAP(indicator.state, bar);
        break;
      case 'ADX':
        updateADX(indicator.state, bar);
        break;
      case 'OBV':
        updateOBV(indicator.state, bar);
        break;
      case 'ATR':
        updateATR(indicator.state, bar);
        break;
    }
  }
}

export function allIndicatorsReady(ctx: IndicatorContext): boolean {
  for (const indicator of ctx.indicators.values()) {
    switch (indicator.type) {
      case 'RSI':
        if (!indicator.state.ready) return false;
        break;
      case 'EMA':
        if (!indicator.state.ready) return false;
        break;
      case 'SMA':
        if (!indicator.state.ready) return false;
        break;
      case 'MACD':
        if (!indicator.state.ready) return false;
        break;
      case 'BB':
        if (!indicator.state.ready) return false;
        break;
      case 'STOCH':
        if (!indicator.state.ready) return false;
        break;
      case 'VWAP':
        if (!indicator.state.ready) return false;
        break;
      case 'ADX':
        if (!indicator.state.ready) return false;
        break;
      case 'OBV':
        if (!indicator.state.ready) return false;
        break;
      case 'ATR':
        if (!indicator.state.ready) return false;
        break;
    }
  }
  return ctx.indicators.size > 0;
}

export function getIndicatorValue(indicator: IndicatorState, field?: string): number | null {
  switch (indicator.type) {
    case 'RSI':
      return indicator.state.value;
    case 'EMA':
      return indicator.state.value;
    case 'SMA':
      return indicator.state.value;
    case 'MACD':
      if (field === 'signal') return indicator.state.signal;
      if (field === 'histogram') return indicator.state.histogram;
      return indicator.state.macd;
    case 'BB':
      if (field === 'upper') return indicator.state.upper;
      if (field === 'lower') return indicator.state.lower;
      if (field === 'width') return indicator.state.width;
      return indicator.state.middle;
    case 'STOCH':
      if (field === 'd') return indicator.state.d;
      return indicator.state.k;
    case 'VWAP':
      return indicator.state.value;
    case 'ADX':
      if (field === 'plusDI') return indicator.state.plusDI;
      if (field === 'minusDI') return indicator.state.minusDI;
      return indicator.state.adx;
    case 'OBV':
      return indicator.state.value;
    case 'ATR':
      return indicator.state.value;
    default:
      return null;
  }
}

export function getIndicatorValueById(ctx: IndicatorContext, id: string, field?: string): number | null {
  const indicator = ctx.indicators.get(id);
  if (!indicator) return null;
  return getIndicatorValue(indicator, field);
}

export function getPrevIndicatorValue(ctx: IndicatorContext, id: string): number | null {
  return ctx.prevValues.get(id) ?? null;
}
