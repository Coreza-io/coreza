export interface RiskInput {
  buying_power?: string;
  open_trades_count?: string;
  current_exposure?: string;
  day_loss?: string;
  risk_per_trade: string;          // percentage
  stop_loss_distance: string;      // percentage
  price_per_unit: string;          // absolute price
  daily_loss_limit: string;        // percentage
  max_portfolio_exposure: string;  // percentage
  max_open_trades?: string;        // optional, defaults to unlimited
  min_buying_power?: string;       // absolute value
  action_on_violation?: 'block' | 'resize' | 'alert_only';
}

export interface RiskOutput {
  allowed: boolean;
  quantity: string;
  position_size: string;
  risk_amount: string;
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
      // --- Helpers ---
      const parseNum = (raw: string | undefined, def = NaN): number => {
        const n = Number(raw);
        return Number.isFinite(n) ? n : def;
      };
      const toFraction = (n: number, name: string): number => {
        if (n > 1) return n / 100;
        if (n >= 0 && n <= 1) return n;
        throw new Error(`${name} must be a percentage (e.g. "2" for 2% or "0.02")`);
      };

      // --- 1) Destructure raw inputs ---
      const {
        buying_power:           rawBP,
        open_trades_count:      rawOpen     = '0',
        current_exposure:       rawExposure = '0',
        day_loss:               rawDayLoss  = '0',
        risk_per_trade:         rawRiskPct,
        stop_loss_distance:     rawStopPct,
        price_per_unit:         rawPrice,
        daily_loss_limit:       rawDailyPct,
        max_portfolio_exposure: rawPortPct,
        max_open_trades:        rawMaxOpen,
        min_buying_power:       rawMinBP     = '0',
        action_on_violation     = 'block'
      } = input;

      // --- 2) Parse & validate absolute amounts ---
      const bp           = parseNum(rawBP);
      const pricePerUnit = parseNum(rawPrice);
      if (bp <= 0)           throw new Error('buying_power must be > 0');
      if (pricePerUnit <= 0) throw new Error('price_per_unit must be > 0');

      // --- 3) Parse & convert percentages to fractions ---
      const riskPct  = toFraction(parseNum(rawRiskPct), 'risk_per_trade');
      const stopPct  = toFraction(parseNum(rawStopPct), 'stop_loss_distance');
      const dailyPct = toFraction(parseNum(rawDailyPct), 'daily_loss_limit');
      const portPct  = toFraction(parseNum(rawPortPct), 'max_portfolio_exposure');

      // --- 4) Compute dollar stop-loss distance ---
      const stopDollar = pricePerUnit * stopPct;
      if (stopDollar <= 0) throw new Error('stop_loss_distance must yield a positive dollar amount');

      // --- 5) Parse optional counters & limits ---
      const openTradesCount = parseNum(rawOpen, 0);
      const currentExposure = parseNum(rawExposure, 0);
      const dayLoss         = parseNum(rawDayLoss, 0);
      const maxOpenTrades   = parseNum(rawMaxOpen, Infinity);
      const minBuyingPower  = parseNum(rawMinBP, 0);

      // --- 6) Core risk math ---
      const riskAmount = bp * riskPct;                                // $ allocated to this trade
      let quantity     = Math.max(0, Math.floor(riskAmount / stopDollar));
      let positionSize = quantity * pricePerUnit;
      const actualRisk = quantity * stopDollar;                       // $ actually at risk

      // --- 7) Check for violations ---
      const violations: string[] = [];
      if (openTradesCount + 1 > maxOpenTrades)          violations.push('max_open_trades');
      if (currentExposure + positionSize > bp * portPct) violations.push('max_portfolio_exposure');
      if (dayLoss + actualRisk > bp * dailyPct)          violations.push('daily_loss_limit');
      if (bp - positionSize < minBuyingPower)            violations.push('min_buying_power');

      // --- 8) Apply action_on_violation ---
      let allowed = violations.length === 0;
      if (action_on_violation === 'alert_only') {
        allowed = true;
      } else if (action_on_violation === 'resize' && violations.length > 0) {
        // re-compute the strictest quantity limit
        const limits = [
          quantity,
          Math.floor((bp * portPct - currentExposure) / pricePerUnit),
          Math.floor((bp * dailyPct - dayLoss) / stopDollar),
          Math.floor((bp - minBuyingPower) / pricePerUnit),
          openTradesCount + 1 > maxOpenTrades ? 0 : Infinity
        ].filter(n => Number.isFinite(n) && n >= 0);
        quantity     = Math.max(0, Math.min(...limits));
        positionSize = quantity * pricePerUnit;
        allowed      = quantity > 0;
      }

      // --- 9) Build stringified output ---
      const output: RiskOutput = {
        allowed,
        quantity:      quantity.toString(),
        position_size: positionSize.toString(),
        risk_amount:   actualRisk.toString(),
        action:        action_on_violation,
        violations:    violations.length > 0 ? violations : undefined
      };

      return { success: true, data: output };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
