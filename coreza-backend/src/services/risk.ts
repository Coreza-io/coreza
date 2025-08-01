export interface RiskInput {
  account_size: number;
  open_trades_count?: number;
  current_exposure?: number;
  day_loss?: number;
  buying_power?: number;
  risk_per_trade: number;
  stop_loss_distance: number;
  price_per_unit: number;
  daily_loss_limit: number;
  max_portfolio_exposure: number;
  max_open_trades?: number;
  min_buying_power?: number;
  action_on_violation?: 'block' | 'resize' | 'alert_only';
}

export interface RiskOutput {
  allowed: boolean;
  quantity: number;
  position_size: number;
  risk_amount: number;
  violations?: string[];
  action?: string;
}

export interface RiskResult {
  success: boolean;
  data?: RiskOutput;
  error?: string;
}

export class RiskEngineService {
  static evaluate(input: RiskInput): RiskResult {
    try {
      const {
        account_size,
        open_trades_count = 0,
        current_exposure = 0,
        day_loss = 0,
        buying_power = account_size,
        risk_per_trade,
        stop_loss_distance,
        price_per_unit,
        daily_loss_limit,
        max_portfolio_exposure,
        max_open_trades = Infinity,
        min_buying_power = 0,
        action_on_violation = 'block'
      } = input;

      if (!Number.isFinite(account_size) || account_size <= 0) {
        throw new Error('account_size must be a positive number');
      }
      if (!Number.isFinite(stop_loss_distance) || stop_loss_distance <= 0) {
        throw new Error('stop_loss_distance must be a positive number');
      }
      if (!Number.isFinite(price_per_unit) || price_per_unit <= 0) {
        throw new Error('price_per_unit must be a positive number');
      }

      const riskAmount = (account_size * risk_per_trade) / 100;
      let quantity = Math.floor(riskAmount / stop_loss_distance);
      if (quantity < 0) quantity = 0;
      let positionSize = quantity * price_per_unit;

      const violations: string[] = [];
      if (open_trades_count + 1 > max_open_trades) violations.push('max_open_trades');
      if (current_exposure + positionSize > (account_size * max_portfolio_exposure) / 100) {
        violations.push('max_portfolio_exposure');
      }
      if (day_loss + riskAmount > (account_size * daily_loss_limit) / 100) {
        violations.push('daily_loss_limit');
      }
      if (buying_power - positionSize < min_buying_power) {
        violations.push('min_buying_power');
      }

      let allowed = violations.length === 0;

      if (action_on_violation === 'alert_only') {
        allowed = true;
      } else if (action_on_violation === 'resize' && violations.length > 0) {
        const qtyLimits: number[] = [quantity];
        if (open_trades_count + 1 > max_open_trades) qtyLimits.push(0);
        qtyLimits.push(
          Math.floor(((account_size * max_portfolio_exposure) / 100 - current_exposure) / price_per_unit)
        );
        qtyLimits.push(
          Math.floor(((account_size * daily_loss_limit) / 100 - day_loss) / stop_loss_distance)
        );
        qtyLimits.push(Math.floor((buying_power - min_buying_power) / price_per_unit));
        quantity = Math.max(0, Math.min(...qtyLimits.filter(n => Number.isFinite(n) && n >= 0)));
        positionSize = quantity * price_per_unit;
        allowed = quantity > 0;
      }

      const output: RiskOutput = {
        allowed,
        quantity,
        position_size: positionSize,
        risk_amount: quantity * stop_loss_distance,
        action: action_on_violation,
        violations: violations.length ? violations : undefined
      };

      return { success: true, data: output };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
