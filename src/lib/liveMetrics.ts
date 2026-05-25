import { BacktestResultMetrics } from "@/hooks/useBacktestResults";

type LivePortfolioSummary = Partial<BacktestResultMetrics> & {
  total_equity?: number;
  realized_pnl?: number;
  trades_count?: number;
  starting_equity?: number;
  initial_capital?: number;
};

type LiveSnapshot = {
  id: string;
  snapshot_at: string;
  cash?: number | null;
  equity?: number | null;
  total_value_usdt?: number | null;
  realized_pnl?: number | null;
  balances?: Record<string, unknown> | null;
};

type ClosedTrade = {
  netPnl?: number;
  commission?: number;
  slippage?: number;
  entryTime?: string | number | Date;
  exitTime?: string | number | Date;
  entryPrice?: number;
  quantity?: number;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const stdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

type ReturnSeries = {
  returns: number[];
  equitySeries: number[];
  periodsPerYear: number;
  minSamplesForRatios: number;
};

const resampleToReturnSeries = (points: { ts: number; equity: number }[]): ReturnSeries => {
  if (points.length < 2) {
    return { returns: [], equitySeries: points.map((p) => p.equity), periodsPerYear: 252, minSamplesForRatios: 30 };
  }
  const DAY_MS = 86_400_000;
  const HOUR_MS = 3_600_000;
  const positivePoints = points.filter((p) => p.equity > 0);
  const snapshotEquity = positivePoints.map((p) => p.equity);
  const snapshotReturns: number[] = [];
  for (let i = 1; i < snapshotEquity.length; i += 1) {
    const prev = snapshotEquity[i - 1];
    if (prev > 0) snapshotReturns.push((snapshotEquity[i] - prev) / prev);
  }

  const dailyClose = new Map<number, number>();
  for (const point of positivePoints) dailyClose.set(Math.floor(point.ts / DAY_MS), point.equity);
  const dailyEquity = Array.from(dailyClose.keys()).sort((a, b) => a - b).map((k) => dailyClose.get(k) ?? 0);
  const dailyReturns: number[] = [];
  for (let i = 1; i < dailyEquity.length; i += 1) {
    const prev = dailyEquity[i - 1];
    if (prev > 0) dailyReturns.push((dailyEquity[i] - prev) / prev);
  }
  if (dailyReturns.length >= 2) return { returns: dailyReturns, equitySeries: dailyEquity, periodsPerYear: 252, minSamplesForRatios: 30 };

  const hourlyClose = new Map<number, number>();
  for (const point of positivePoints) hourlyClose.set(Math.floor(point.ts / HOUR_MS), point.equity);
  const hourlyEquity = Array.from(hourlyClose.keys()).sort((a, b) => a - b).map((k) => hourlyClose.get(k) ?? 0);
  const hourlyReturns: number[] = [];
  for (let i = 1; i < hourlyEquity.length; i += 1) {
    const prev = hourlyEquity[i - 1];
    if (prev > 0) hourlyReturns.push((hourlyEquity[i] - prev) / prev);
  }
  if (hourlyReturns.length >= 2) return { returns: hourlyReturns, equitySeries: hourlyEquity, periodsPerYear: 252 * 6.5, minSamplesForRatios: 20 };

  return { returns: snapshotReturns, equitySeries: snapshotEquity, periodsPerYear: 0, minSamplesForRatios: 20 };
};

const calculateRiskMetrics = (equityPoints: { ts: number; equity: number }[], baselineCapital?: number) => {
  const EPSILON = 1e-8;
  if (equityPoints.length < 2) return { max_drawdown: undefined, annualized_return: undefined, sharpe_ratio: undefined, sortino_ratio: undefined, calmar_ratio: undefined };
  const firstEquity = equityPoints[0].equity;
  const lastEquity = equityPoints[equityPoints.length - 1].equity;
  let peak = Math.max(firstEquity, baselineCapital ?? 0);
  let maxDrawdownPct = 0;
  for (const point of equityPoints) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - point.equity) / peak) * 100);
  }

  const { returns, equitySeries, periodsPerYear, minSamplesForRatios } = resampleToReturnSeries(equityPoints);
  const totalReturnPct = firstEquity > 0 ? ((lastEquity - firstEquity) / firstEquity) * 100 : undefined;
  let annualizedReturn: number | undefined;
  const yearsElapsed = periodsPerYear > 0 && equitySeries.length > 1 ? (equitySeries.length - 1) / periodsPerYear : 0;
  if (periodsPerYear === 0) {
    annualizedReturn = totalReturnPct;
  } else if (returns.length >= 2 && yearsElapsed > 0 && periodsPerYear <= 252) {
    annualizedReturn = firstEquity > 0 ? (Math.pow(lastEquity / firstEquity, 1 / yearsElapsed) - 1) * 100 : totalReturnPct;
  } else {
    annualizedReturn = totalReturnPct;
  }
  if (annualizedReturn !== undefined) {
    if (!Number.isFinite(annualizedReturn)) annualizedReturn = undefined;
    else annualizedReturn = Math.min(100000, Math.max(-100, annualizedReturn));
  }

  const enoughForRatios = returns.length >= minSamplesForRatios;
  if (!enoughForRatios || annualizedReturn === undefined) {
    return { max_drawdown: maxDrawdownPct, annualized_return: annualizedReturn, sharpe_ratio: undefined, sortino_ratio: undefined, calmar_ratio: annualizedReturn !== undefined && maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : undefined };
  }

  const periodRf = 0;
  const excessReturns = returns.map((r) => r - periodRf);
  const avgExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const volatility = stdDev(excessReturns);
  const annualizationFactor = periodsPerYear > 0 ? Math.sqrt(periodsPerYear) : 1;
  const sharpeRatio = volatility > EPSILON ? (avgExcess / volatility) * annualizationFactor : 0;
  const downside = excessReturns.filter((r) => r < 0);
  const downsideDeviation = downside.length > 0 ? Math.sqrt(downside.reduce((sum, r) => sum + r * r, 0) / downside.length) : 0;
  const sortinoRatio = downside.length === 0 ? (avgExcess > 0 ? Infinity : 0) : downsideDeviation > EPSILON ? (avgExcess / downsideDeviation) * annualizationFactor : 0;
  const calmarRatio = annualizedReturn !== undefined && maxDrawdownPct > 0 ? annualizedReturn / maxDrawdownPct : undefined;

  return {
    max_drawdown: maxDrawdownPct,
    annualized_return: annualizedReturn,
    sharpe_ratio: Number.isFinite(sharpeRatio) ? sharpeRatio : undefined,
    sortino_ratio: Number.isFinite(sortinoRatio) ? sortinoRatio : undefined,
    calmar_ratio: calmarRatio !== undefined && Number.isFinite(calmarRatio) ? calmarRatio : undefined,
  };
};

export const mapLiveSnapshotToEquityPoint = (snapshot: LiveSnapshot) => {
  const ts = Date.parse(snapshot.snapshot_at);
  const cash = toFiniteNumber(snapshot.cash) ?? 0;
  const equity = toFiniteNumber(snapshot.equity) ?? toFiniteNumber(snapshot.total_value_usdt) ?? cash;
  return { ts, cash, equity };
};

const deriveCapitalFromPositiveBalance = (balances: unknown): number | undefined => {
  if (!balances || typeof balances !== "object") return undefined;
  const values = Object.values(balances as Record<string, unknown>).map((value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (value && typeof value === "object") {
      const candidate = value as Record<string, unknown>;
      return toFiniteNumber(candidate.usdValue) ?? toFiniteNumber(candidate.usdtValue) ?? toFiniteNumber(candidate.value) ?? toFiniteNumber(candidate.total);
    }
    return toFiniteNumber(value);
  }).filter((v): v is number => v !== undefined && v > 0);
  return values.length > 0 ? Math.max(...values) : undefined;
};

export const normalizeLiveEquitySnapshots = (snapshots: LiveSnapshot[] = [], portfolioSummary?: LivePortfolioSummary) => {
  const EPSILON = 1e-9;
  const cleanSnapshots = snapshots.map(mapLiveSnapshotToEquityPoint).filter((point) => Number.isFinite(point.ts)).sort((a, b) => a.ts - b.ts);
  const rawFinalEquity = toFiniteNumber(portfolioSummary?.total_equity) ?? (cleanSnapshots.length > 0 ? cleanSnapshots[cleanSnapshots.length - 1].equity : undefined);
  const latestRealizedPnl = toFiniteNumber(snapshots[snapshots.length - 1]?.realized_pnl);
  const inferredInitialCapitalFromPnl = latestRealizedPnl !== undefined && rawFinalEquity !== undefined ? rawFinalEquity - latestRealizedPnl : undefined;
  const candidateInitialCapital = toFiniteNumber(portfolioSummary?.initial_capital) ?? toFiniteNumber(portfolioSummary?.starting_equity) ?? deriveCapitalFromPositiveBalance(snapshots[0]?.balances) ?? (cleanSnapshots.length > 0 ? cleanSnapshots[0].equity : undefined);
  const initialCapital = candidateInitialCapital !== undefined && Math.abs(candidateInitialCapital) > EPSILON ? candidateInitialCapital : inferredInitialCapitalFromPnl;
  const shouldTranslateFromPnl = initialCapital !== undefined && initialCapital > 0 && cleanSnapshots.length > 1 && cleanSnapshots.some((point) => point.equity <= 0) && Math.max(...cleanSnapshots.map((point) => Math.abs(point.equity))) < initialCapital * 0.25;
  const normalizedSnapshots = shouldTranslateFromPnl ? cleanSnapshots.map((point) => ({ ...point, equity: point.equity + initialCapital })) : cleanSnapshots;
  return { normalizedSnapshots, initialCapital, shouldTranslateFromPnl, rawFinalEquity };
};

export const buildLiveMetrics = (portfolioSummary?: LivePortfolioSummary, closedTrades: ClosedTrade[] = [], snapshots: LiveSnapshot[] = []): BacktestResultMetrics => {
  const { normalizedSnapshots, initialCapital, shouldTranslateFromPnl, rawFinalEquity } = normalizeLiveEquitySnapshots(snapshots, portfolioSummary);
  const riskMetrics = calculateRiskMetrics(normalizedSnapshots, initialCapital);
  const finalPortfolioValue = toFiniteNumber(portfolioSummary?.final_portfolio_value) ?? (shouldTranslateFromPnl && initialCapital ? (rawFinalEquity ?? 0) + initialCapital : rawFinalEquity);
  const computedTotalReturn = initialCapital !== undefined && initialCapital > 0 && finalPortfolioValue !== undefined ? ((finalPortfolioValue - initialCapital) / initialCapital) * 100 : undefined;
  const tradeNetProfit = closedTrades.reduce((sum, trade) => sum + (toFiniteNumber(trade.netPnl) ?? 0), 0);
  const pnls = closedTrades.map((trade) => toFiniteNumber(trade.netPnl) ?? 0);
  const winningPnls = pnls.filter((pnl) => pnl > 0);
  const losingPnls = pnls.filter((pnl) => pnl < 0);
  const profitableTrades = winningPnls.length;
  const losingTrades = losingPnls.length;
  const totalTrades = closedTrades.length;
  const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
  const totalWins = winningPnls.reduce((sum, pnl) => sum + pnl, 0);
  const totalLossesAbs = Math.abs(losingPnls.reduce((sum, pnl) => sum + pnl, 0));
  const avgWin = profitableTrades > 0 ? totalWins / profitableTrades : 0;
  const avgLoss = losingTrades > 0 ? losingPnls.reduce((sum, pnl) => sum + pnl, 0) / losingTrades : undefined;
  const largestWin = profitableTrades > 0 ? Math.max(...winningPnls) : 0;
  const largestLoss = losingTrades > 0 ? Math.min(...losingPnls) : undefined;
  const profitFactor = totalLossesAbs > 0 ? totalWins / totalLossesAbs : totalWins > 0 ? Infinity : 0;
  const averageTradeReturn = totalTrades > 0 && initialCapital && initialCapital > 0 ? pnls.reduce((sum, pnl) => sum + (pnl / initialCapital) * 100, 0) / totalTrades : 0;
  const totalCommission = closedTrades.reduce((sum, trade) => sum + (toFiniteNumber(trade.commission) ?? 0), 0);
  const totalSlippage = closedTrades.reduce((sum, trade) => sum + (toFiniteNumber(trade.slippage) ?? 0), 0);
  const holdingDurationsMs = closedTrades.map((trade) => {
    const entryTs = trade.entryTime instanceof Date ? trade.entryTime.getTime() : Date.parse(String(trade.entryTime ?? ""));
    const exitTs = trade.exitTime instanceof Date ? trade.exitTime.getTime() : Date.parse(String(trade.exitTime ?? ""));
    return Number.isFinite(entryTs) && Number.isFinite(exitTs) && exitTs >= entryTs ? exitTs - entryTs : undefined;
  }).filter((v): v is number => v !== undefined);
  const avgHoldingPeriod = holdingDurationsMs.length > 0 ? holdingDurationsMs.reduce((sum, ms) => sum + ms, 0) / holdingDurationsMs.length : undefined;
  const expectancy = totalTrades > 0 ? tradeNetProfit / totalTrades : 0;

  return {
    total_return: toFiniteNumber(portfolioSummary?.total_return) ?? computedTotalReturn,
    net_profit: toFiniteNumber(portfolioSummary?.net_profit) ?? toFiniteNumber(portfolioSummary?.realized_pnl) ?? tradeNetProfit,
    total_trades: toFiniteNumber(portfolioSummary?.total_trades) ?? toFiniteNumber(portfolioSummary?.trades_count) ?? totalTrades,
    final_portfolio_value: finalPortfolioValue,
    profitable_trades: toFiniteNumber(portfolioSummary?.profitable_trades) ?? profitableTrades,
    losing_trades: toFiniteNumber(portfolioSummary?.losing_trades) ?? losingTrades,
    win_rate: toFiniteNumber(portfolioSummary?.win_rate) ?? winRate,
    profit_factor: toFiniteNumber(portfolioSummary?.profit_factor) ?? profitFactor,
    avg_win: toFiniteNumber(portfolioSummary?.avg_win) ?? avgWin,
    avg_loss: toFiniteNumber(portfolioSummary?.avg_loss) ?? avgLoss,
    largest_win: toFiniteNumber(portfolioSummary?.largest_win) ?? largestWin,
    largest_loss: toFiniteNumber(portfolioSummary?.largest_loss) ?? largestLoss,
    average_trade_return: toFiniteNumber(portfolioSummary?.average_trade_return) ?? averageTradeReturn,
    expectancy: toFiniteNumber(portfolioSummary?.expectancy) ?? expectancy,
    total_commission: toFiniteNumber(portfolioSummary?.total_commission) ?? totalCommission,
    total_slippage: toFiniteNumber(portfolioSummary?.total_slippage) ?? totalSlippage,
    avg_holding_period: toFiniteNumber(portfolioSummary?.avg_holding_period) ?? avgHoldingPeriod,
    ...riskMetrics,
  };
};
