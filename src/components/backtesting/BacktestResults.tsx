import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, Target, BarChart3, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

interface BacktestResultsProps {
  backtestId: string;
  onBack: () => void;
}

interface BacktestData {
  backtest: any;
  results: any;
  trades: any[];
  snapshots: any[];
}

export function BacktestResults({ backtestId, onBack }: BacktestResultsProps) {
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBacktestData();
  }, [backtestId]);

  const loadBacktestData = async () => {
    try {
      // Get backtest details (without workflow join due to foreign key issue)
      const { data: backtest, error: backtestError } = await supabase
        .from('backtests')
        .select('*')
        .eq('id', backtestId)
        .single();

      if (backtestError) throw backtestError;

      // Get results
      const { data: results, error: resultsError } = await supabase
        .from('backtest_results')
        .select('*')
        .eq('backtest_id', backtestId)
        .maybeSingle();

      // Get trades
      const { data: trades, error: tradesError } = await supabase
        .from('backtest_trades')
        .select('*')
        .eq('backtest_id', backtestId)
        .order('timestamp');

      // Get portfolio snapshots
      const { data: snapshots, error: snapshotsError } = await supabase
        .from('backtest_portfolio_snapshots')
        .select('*')
        .eq('backtest_id', backtestId)
        .order('date');

      setData({
        backtest,
        results: results || null,
        trades: trades || [],
        snapshots: snapshots || []
      });
    } catch (error) {
      console.error('Error loading backtest data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(2)}%`;
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">Loading backtest results...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <div className="text-center">Failed to load backtest data</div>
      </div>
    );
  }

  const { backtest, results, trades, snapshots } = data;

  // Prepare chart data
  const chartData = snapshots.map(snapshot => ({
    date: snapshot.date,
    value: snapshot.total_value,
    return: ((snapshot.total_value - backtest.initial_capital) / backtest.initial_capital * 100).toFixed(2)
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Backtests
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{backtest.name}</h1>
          <p className="text-muted-foreground">
            Workflow ID: {backtest.workflow_id} • {format(new Date(backtest.start_date), 'MMM dd, yyyy')} - {format(new Date(backtest.end_date), 'MMM dd, yyyy')}
          </p>
        </div>
      </div>

      {!results ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Activity className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Results Available</h3>
            <p className="text-muted-foreground">
              This backtest hasn't been run yet or is still processing.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Total Return
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    {results.total_return >= 0 ? (
                      <TrendingUp className="h-5 w-5 text-green-500" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-red-500" />
                    )}
                    <div className={`text-2xl font-bold ${
                      results.total_return >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {formatPercentage(results.total_return)}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatCurrency(results.final_portfolio_value - backtest.initial_capital)} profit/loss
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Sharpe Ratio
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{results.sharpe_ratio.toFixed(2)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Risk-adjusted return
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Max Drawdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    -{formatPercentage(results.max_drawdown)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Largest peak-to-trough decline
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Win Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatPercentage(results.win_rate)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {results.profitable_trades} of {results.total_trades} trades
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Portfolio Value Over Time</CardTitle>
                <CardDescription>
                  Track how your portfolio value changed throughout the backtest period
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="date" 
                        tickFormatter={(date) => format(new Date(date), 'MMM dd')}
                      />
                      <YAxis 
                        tickFormatter={(value) => formatCurrency(value)}
                      />
                      <Tooltip 
                        labelFormatter={(date) => format(new Date(date), 'MMM dd, yyyy')}
                        formatter={(value: any, name: string) => [
                          name === 'value' ? formatCurrency(value) : `${value}%`,
                          name === 'value' ? 'Portfolio Value' : 'Return'
                        ]}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#8884d8" 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Performance Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Total Return</span>
                    <span className={results.total_return >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {formatPercentage(results.total_return)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Annualized Return</span>
                    <span>{formatPercentage(results.annualized_return)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Max Drawdown</span>
                    <span className="text-red-600">-{formatPercentage(results.max_drawdown)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sharpe Ratio</span>
                    <span>{results.sharpe_ratio.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Win Rate</span>
                    <span>{formatPercentage(results.win_rate)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Trading Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between">
                    <span>Total Trades</span>
                    <span>{results.total_trades}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Profitable Trades</span>
                    <span className="text-green-600">{results.profitable_trades}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Losing Trades</span>
                    <span className="text-red-600">{results.total_trades - results.profitable_trades}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Average Trade Return</span>
                    <span>{formatPercentage(results.average_trade_return)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Largest Win</span>
                    <span className="text-green-600">{formatPercentage(results.largest_win)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Largest Loss</span>
                    <span className="text-red-600">{formatPercentage(results.largest_loss)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="trades" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Trade History</CardTitle>
                <CardDescription>
                  Detailed view of all trades executed during the backtest
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trades.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No trades were executed during this backtest
                  </p>
                ) : (
                  <div className="space-y-2">
                    {trades.map((trade, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded">
                        <div className="flex items-center gap-4">
                          <Badge variant={trade.action === 'buy' ? 'default' : 'secondary'}>
                            {trade.action.toUpperCase()}
                          </Badge>
                          <span className="font-medium">{trade.symbol}</span>
                          <span>{trade.quantity} shares @ {formatCurrency(trade.price)}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">
                            {format(new Date(trade.timestamp), 'MMM dd, yyyy HH:mm')}
                          </div>
                          <div className="text-sm">
                            Total: {formatCurrency(trade.quantity * trade.price)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="portfolio" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Portfolio Snapshots</CardTitle>
                <CardDescription>
                  Daily portfolio composition and value changes
                </CardDescription>
              </CardHeader>
              <CardContent>
                {snapshots.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No portfolio snapshots available
                  </p>
                ) : (
                  <div className="space-y-2">
                    {snapshots.slice(-10).map((snapshot, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded">
                        <div>
                          <div className="font-medium">
                            {format(new Date(snapshot.date), 'MMM dd, yyyy')}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Cash: {formatCurrency(snapshot.cash_balance)} | 
                            Stocks: {formatCurrency(snapshot.stock_value)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">
                            {formatCurrency(snapshot.total_value)}
                          </div>
                          <div className={`text-sm ${
                            snapshot.daily_return >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {snapshot.daily_return >= 0 ? '+' : ''}{formatPercentage(snapshot.daily_return)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}