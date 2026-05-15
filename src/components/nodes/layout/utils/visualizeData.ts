export interface CandleDict {
  t: Array<string | number | undefined>;
  o: any[];
  h: any[];
  l: any[];
  c: any[];
  v: any[];
}

const normalizeTime = (t: any): string | undefined => {
  if (t == null) return undefined;
  if (typeof t === "number") {
    try {
      return new Date(t).toISOString().slice(0, 10);
    } catch {
      return undefined;
    }
  }
  if (typeof t === "string") {
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      try {
        return new Date(n).toISOString().slice(0, 10);
      } catch {
        return undefined;
      }
    }
    return t.slice(0, 10);
  }
  return undefined;
};

export const toDictOfArrays = (candlesArray: any): CandleDict | any => {
  if (!Array.isArray(candlesArray)) return candlesArray;
  return candlesArray.reduce(
    (acc, c) => {
      acc.t.push(normalizeTime(c?.t ?? c?.time));
      acc.o.push(c?.o ?? c?.open);
      acc.h.push(c?.h ?? c?.high);
      acc.l.push(c?.l ?? c?.low);
      acc.c.push(c?.c ?? c?.close);
      acc.v.push(c?.v ?? c?.volume);
      return acc;
    },
    { t: [], o: [], h: [], l: [], c: [], v: [] } as CandleDict
  );
};

export const findBars = (input: any): any[] | null => {
  if (!input) return null;
  if (Array.isArray(input?.data?.BarSeries?.[0]?.bars)) return input.data.BarSeries[0].bars;
  if (Array.isArray(input?.BarSeries?.[0]?.bars)) return input.BarSeries[0].bars;
  if (Array.isArray(input?.bars)) return input.bars;
  if (Array.isArray(input?.candles)) return input.candles;
  if (Array.isArray(input)) return input;
  return null;
};

export const resolveVisualizeData = (selectedInputData: any, configuredCandles: any) => {
  const firstInput = Array.isArray(selectedInputData)
    ? selectedInputData[0]
    : selectedInputData;

  let vizCandles: any = null;
  let vizIndicator = null;

  if (configuredCandles) {
    vizCandles = toDictOfArrays(configuredCandles);
  } else {
    const bars = findBars(firstInput);
    if (bars) {
      vizCandles = toDictOfArrays(bars);
    } else if (firstInput?.candles && typeof firstInput.candles === "object") {
      vizCandles = firstInput.candles;
    }
  }

  if (firstInput?.indicator) {
    vizIndicator = firstInput.indicator;
  }

  const filteredIndicator = Array.isArray(vizIndicator)
    ? vizIndicator.filter((d: any) => d && d.value !== null && !Number.isNaN(d.value))
    : [];

  return { vizCandles, filteredIndicator };
};
