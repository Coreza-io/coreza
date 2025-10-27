import { describe, test, expect } from '@jest/globals';
const express = require('../../coreza-backend/node_modules/express');
import request from 'supertest';
import riskRoutes from '../../coreza-backend/src/routes/risk';
import { RiskExecutor } from '../../coreza-backend/src/nodes/executors/RiskExecutor';

describe('Risk Engine node and API', () => {
  test('POST /risk/engine evaluates risk', async () => {
    const app = express();
    app.use(express.json());
    app.use('/risk', riskRoutes);

    const res = await request(app)
      .post('/risk/engine')
      .send({
        account_size: 10000,
        risk_per_trade: 1,
        stop_loss_distance: 2,
        price_per_unit: 20,
        daily_loss_limit: 5,
        max_portfolio_exposure: 50,
        action_on_violation: 'block'
      })
      .expect(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.quantity).toBe(50);
  });

  test('RiskExecutor blocks when exposure too high', async () => {
    const executor = new RiskExecutor();
    const node = {
      id: 'risk1',
      type: 'Risk Engine',
      category: 'Risk Management',
      values: {
        account_size: 10000,
        current_exposure: 4000,
        risk_per_trade: 2,
        stop_loss_distance: 1,
        price_per_unit: 50,
        daily_loss_limit: 5,
        max_portfolio_exposure: 20,
        action_on_violation: 'block'
      }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data.allowed).toBe(false);
    expect(result.data.violations).toContain('max_portfolio_exposure');
  });
});
