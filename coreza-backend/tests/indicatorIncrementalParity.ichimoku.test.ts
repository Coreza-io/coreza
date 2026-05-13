const { IndicatorService } = require('../src/nodes/logic/indicators');
const { IchimokuCloud } = require('technicalindicators');

function genBars(count) {
  const bars = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += Math.sin(i / 8) * 0.8 + 0.2;
    const high = price + 1 + (i % 3) * 0.1;
    const low = price - 1 - (i % 2) * 0.1;
    bars.push({ time: new Date(2024, 0, 1 + i).toISOString(), high, low, close: price });
  }
  return bars;
}

describe('Ichimoku incremental parity', () => {
  it('matches technicalindicators output on sequential updates', () => {
    const bars = genBars(200);
    const params = { conversion_period: 9, base_period: 26, leading_span_b_period: 52, displacement: 26 };
    const updater = IndicatorService.createIncrementalUpdater('ichimoku', params);
    const warm = updater.warmUp([]);
    let state = warm.internalState;

    const high = [];
    const low = [];
    for (const bar of bars) {
      const inc = updater.update(state, bar);
      state = inc.internalState;
      high.push(bar.high);
      low.push(bar.low);
      const all = IchimokuCloud.calculate({
        high,
        low,
        conversionPeriod: params.conversion_period,
        basePeriod: params.base_period,
        spanPeriod: params.leading_span_b_period,
        displacement: params.displacement,
      });
      const expected = all.length ? all[all.length - 1] : null;
      if (!expected) {
        expect(inc.value).toBeTruthy();
        continue;
      }
      expect(inc.value.tenkan).toBeCloseTo(expected.conversion, 9);
      expect(inc.value.kijun).toBeCloseTo(expected.base, 9);
      expect(inc.value.senkouA).toBeCloseTo(expected.spanA, 9);
      expect(inc.value.senkouB).toBeCloseTo(expected.spanB, 9);
    }
  });
});
