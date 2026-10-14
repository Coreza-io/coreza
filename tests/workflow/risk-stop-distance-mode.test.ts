import { describe, expect, test } from '@jest/globals';
import { RiskEngineService } from '../../coreza-backend/src/nodes/logic/risk';

const base = {
  buying_power: '100000',
  symbol: 'AAPL',
  risk_per_trade: '2',
  stop_loss_distance: '5',
  price_per_unit: '100',
  daily_loss_limit: '5',
  max_portfolio_exposure: '100',
  min_buying_power: '0',
  action_on_violation: 'block' as const,
};

describe('Risk Engine stop loss distance mode', () => {
  test('defaults to existing percentage behavior', () => {
    const result = RiskEngineService.evaluate(base);
    expect(result.success).toBe(true);
    expect(result.data?.quantity).toBe('400');
  });

  test('explicit percentage mode matches default', () => {
    const result = RiskEngineService.evaluate({ ...base, stop_loss_distance_mode: 'percentage' });
    expect(result.success).toBe(true);
    expect(result.data?.quantity).toBe('400');
  });

  test('absolute value mode divides risk by supplied price distance', () => {
    const result = RiskEngineService.evaluate({ ...base, stop_loss_distance_mode: 'value', stop_loss_distance: '6.626666666666665' });
    expect(result.success).toBe(true);
    expect(result.data?.quantity).toBe('301');
  });

  test('rejects invalid mode', () => {
    const result = RiskEngineService.evaluate({ ...base, stop_loss_distance_mode: 'auto' as any });
    expect(result.success).toBe(false);
  });

  test('rejects nonpositive distance in value mode', () => {
    const result = RiskEngineService.evaluate({ ...base, stop_loss_distance_mode: 'value', stop_loss_distance: '0' });
    expect(result.success).toBe(false);
  });
});
