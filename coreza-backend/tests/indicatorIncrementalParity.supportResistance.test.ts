const { IndicatorService } = require('../src/nodes/logic/indicators');

function genBars(count) {
  const bars = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += Math.cos(i / 5) * 0.7;
    bars.push({
      time: new Date(2024, 0, 1 + i).toISOString(),
      high: price + 1.5,
      low: price - 1.5,
      close: price,
    });
  }
  return bars;
}

async function runBatch(method, bars, params) {
  const input = { method, ...params, candle_data: JSON.stringify(bars.map((b) => ({ high: b.high, low: b.low, close: b.close, time: b.time }))) };
  const out = await IndicatorService.calculate('support-resistance', input);
  return out.data?.[0] ?? null;
}

describe('Support/Resistance incremental parity', () => {
  it('matches batch results for pivot, swing, historical', async () => {
    const bars = genBars(120);
    const modes = [
      { method: 'pivot', params: { num_levels: 3 } },
      { method: 'swing', params: { lookback_period: 40, sensitivity: 1, num_levels: 3 } },
      { method: 'historical', params: { lookback_period: 40, num_levels: 3 } },
    ];

    for (const mode of modes) {
      const updater = IndicatorService.createIncrementalUpdater('support-resistance', { method: mode.method, ...mode.params });
      let state = updater.warmUp([]).internalState;
      const seen = [];
      for (const bar of bars) {
        seen.push(bar);
        const inc = updater.update(state, bar);
        state = inc.internalState;
        const expected = await runBatch(mode.method, seen, mode.params);
        expect(inc.value).toEqual(expected);
      }
    }
  });
});
