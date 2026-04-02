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
};

type ClosedTrade = {
  netPnl?: number;
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
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const resampleToDailyCloseReturns = (points: { ts: number; equity: number }[]) => {
  if (points.length < 2) return { returns: [] as number[], dailyEquity: [] as number[] };

  const DAY_MS = 86_400_000;
  const dailyClose = new Map<number, number>();

  for (const point of points) {
    if (!(point.equity > 0)) continue;
    const dayBucket = Math.floor(point.ts / DAY_MS);
    dailyClose.set(dayBucket, point.equity);
  }

  const buckets = Array.from(dailyClose.keys()).sort((a, b) => a - b);
  const dailyEquity = buckets.map((bucket) => dailyClose.get(bucket) ?? 0);
  const returns: number[] = [];

  for (let i = 1; i < dailyEquity.length; i += 1) {
    const prev = dailyEquity[i - 1];
    const current = dailyEquity[i];
    if (prev > 0) returns.push((current - prev) / prev);
  }

  return { returns, dailyEquity };
};

const calculateRiskMetrics = (equityPoints: { ts: number; equity: number }[]) => {
  if (equityPoints.length < 2) {
    return {
      max_drawdown: undefined,
      annualized_return: undefined,
      sharpe_ratio: undefined,
      sortino_ratio: undefined,
      calmar_ratio: undefined,
    };
  }

  const firstEquity = equityPoints[0].equity;
  const lastEquity = equityPoints[equityPoints.length - 1].equity;

  let peak = firstEquity;
  let maxDrawdownPct = 0;
  for (const point of equityPoints) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) {
      const drawdownPct = ((peak - point.equity) / peak) * 100;
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    }
  }

  const { returns, dailyEquity } = resampleToDailyCloseReturns(equityPoints);
  const totalReturnPct = firstEquity > 0 ? ((lastEquity - firstEquity) / firstEquity) * 100 : undefined;

  const yearsElapsed = dailyEquity.length > 1 ? (dailyEquity.length - 1) / 252 : 0;
  const annualizedReturn =
    yearsElapsed > 0 && firstEquity > 0
      ? (Math.pow(lastEquity / firstEquity, 1 / yearsElapsed) - 1) * 100
      : totalReturnPct;

  const enoughForRatios = returns.length >= 30;
  if (!enoughForRatios || annualizedReturn === undefined) {
    return {
      max_drawdown: maxDrawdownPct,
      annualized_return: annualizedReturn,
      sharpe_ratio: undefined,
      sortino_ratio: undefined,
      calmar_ratio: maxDrawdownPct > 0 ? annualizedReturn / 100 / maxDrawdownPct : 0,
    };
  }

  const dailyRf = Math.pow(1 + 0.02, 1 / 252) - 1;
  const excessReturns = returns.map((r) => r - dailyRf);
  const avgExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;

  const volatility = stdDev(excessReturns);
  const sharpeRatio = volatility > 0 ? (avgExcess / volatility) * Math.sqrt(252) : 0;

  const downside = excessReturns.filter((r) => r < 0);
  const downsideDeviation =
    downside.length > 0
      ? Math.sqrt(downside.reduce((sum, r) => sum + r * r, 0) / downside.length)
      : 0;
  const sortinoRatio =
    downside.length === 0
      ? avgExcess > 0
        ? Infinity
        : 0
      : downsideDeviation > 0
        ? (avgExcess / downsideDeviation) * Math.sqrt(252)
        : 0;

  const calmarRatio = maxDrawdownPct > 0 ? annualizedReturn / 100 / maxDrawdownPct : 0;

  return {
    max_drawdown: maxDrawdownPct,
    annualized_return: annualizedReturn,
    sharpe_ratio: sharpeRatio,
    sortino_ratio: sortinoRatio,
    calmar_ratio: calmarRatio,
  };
};

export const mapLiveSnapshotToEquityPoint = (snapshot: LiveSnapshot) => {
  const ts = Date.parse(snapshot.snapshot_at);
  const cash = toFiniteNumber(snapshot.cash) ?? 0;
  const equity =
    toFiniteNumber(snapshot.equity) ?? toFiniteNumber(snapshot.total_value_usdt) ?? cash;

  return {
    ts,
    cash,
    equity,
  };
};

export const buildLiveMetrics = (
  portfolioSummary?: LivePortfolioSummary,
  closedTrades: ClosedTrade[] = [],
  snapshots: LiveSnapshot[] = [],
): BacktestResultMetrics => {
  const cleanSnapshots = snapshots
    .map(mapLiveSnapshotToEquityPoint)
    .filter((point) => Number.isFinite(point.ts) && point.equity >= 0)
    .sort((a, b) => a.ts - b.ts);

  const riskMetrics = calculateRiskMetrics(cleanSnapshots);

  const initialCapital =
    toFiniteNumber(portfolioSummary?.initial_capital) ??
    toFiniteNumber(portfolioSummary?.starting_equity) ??
    (cleanSnapshots.length > 0 ? cleanSnapshots[0].equity : undefined);

  const finalPortfolioValue =
    toFiniteNumber(portfolioSummary?.final_portfolio_value) ??
    toFiniteNumber(portfolioSummary?.total_equity) ??
    (cleanSnapshots.length > 0
      ? cleanSnapshots[cleanSnapshots.length - 1].equity
      : undefined);

  const computedTotalReturn =
    initialCapital !== undefined && initialCapital > 0 && finalPortfolioValue !== undefined
      ? ((finalPortfolioValue - initialCapital) / initialCapital) * 100
      : undefined;

  const tradeNetProfit = closedTrades.reduce(
    (sum, trade) => sum + (toFiniteNumber(trade.netPnl) ?? 0),
    0,
  );
  const winningPnls = closedTrades
    .map((trade) => toFiniteNumber(trade.netPnl) ?? 0)
    .filter((pnl) => pnl > 0);
  const losingPnls = closedTrades
    .map((trade) => toFiniteNumber(trade.netPnl) ?? 0)
    .filter((pnl) => pnl < 0);
  const profitableTrades = closedTrades.filter(
    (trade) => (toFiniteNumber(trade.netPnl) ?? 0) > 0,
  ).length;
  const losingTrades = closedTrades.filter(
    (trade) => (toFiniteNumber(trade.netPnl) ?? 0) < 0,
  ).length;
  const totalTrades = closedTrades.length;
  const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
  const totalWins = winningPnls.reduce((sum, pnl) => sum + pnl, 0);
  const totalLossesAbs = Math.abs(losingPnls.reduce((sum, pnl) => sum + pnl, 0));
  const avgWin = profitableTrades > 0 ? totalWins / profitableTrades : 0;
  const avgLoss = losingTrades > 0 ? losingPnls.reduce((sum, pnl) => sum + pnl, 0) / losingTrades : 0;
  const largestWin = profitableTrades > 0 ? Math.max(...winningPnls) : 0;
  const largestLoss = losingTrades > 0 ? Math.min(...losingPnls) : 0;
  const profitFactor =
    totalLossesAbs > 0
      ? totalWins / totalLossesAbs
      : totalWins > 0
        ? Infinity
        : 0;
  const averageTradeReturn =
    totalTrades > 0 && initialCapital && initialCapital > 0
      ? closedTrades.reduce(
          (sum, trade) =>
            sum + ((toFiniteNumber(trade.netPnl) ?? 0) / initialCapital) * 100,
          0,
        ) / totalTrades
      : 0;
  const expectancy = totalTrades > 0 ? tradeNetProfit / totalTrades : 0;

  return {
    total_return: toFiniteNumber(portfolioSummary?.total_return) ?? computedTotalReturn,
    net_profit:
      toFiniteNumber(portfolioSummary?.net_profit) ??
      toFiniteNumber(portfolioSummary?.realized_pnl) ??
      tradeNetProfit,
    total_trades:
      toFiniteNumber(portfolioSummary?.total_trades) ??
      toFiniteNumber(portfolioSummary?.trades_count) ??
      totalTrades,
    final_portfolio_value: finalPortfolioValue,
    profitable_trades:
      toFiniteNumber(portfolioSummary?.profitable_trades) ?? profitableTrades,
    losing_trades: toFiniteNumber(portfolioSummary?.losing_trades) ?? losingTrades,
    win_rate: toFiniteNumber(portfolioSummary?.win_rate) ?? winRate,
    profit_factor: toFiniteNumber(portfolioSummary?.profit_factor) ?? profitFactor,
    avg_win: toFiniteNumber(portfolioSummary?.avg_win) ?? avgWin,
    avg_loss: toFiniteNumber(portfolioSummary?.avg_loss) ?? avgLoss,
    largest_win: toFiniteNumber(portfolioSummary?.largest_win) ?? largestWin,
    largest_loss: toFiniteNumber(portfolioSummary?.largest_loss) ?? largestLoss,
    average_trade_return:
      toFiniteNumber(portfolioSummary?.average_trade_return) ?? averageTradeReturn,
    expectancy: toFiniteNumber(portfolioSummary?.expectancy) ?? expectancy,
    ...riskMetrics,
  };
};
