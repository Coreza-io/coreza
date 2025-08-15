import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BacktestConfig {
  user_id: string;
  workflow_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  commission_rate: number;
  slippage_rate: number;
  data_frequency: string;
}

interface MarketData {
  date: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Portfolio {
  cash: number;
  positions: Record<string, { quantity: number; avgPrice: number }>;
  totalValue: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    if (req.method === 'POST') {
      const { backtestId } = await req.json();

      if (!backtestId) {
        return new Response(
          JSON.stringify({ error: 'Backtest ID is required' }),
          { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      console.log(`Starting backtest execution for ID: ${backtestId}`);

      // Get backtest configuration
      const { data: backtest, error: backtestError } = await supabaseClient
        .from('backtests')
        .select('*')
        .eq('id', backtestId)
        .single();

      if (backtestError || !backtest) {
        console.error('Failed to fetch backtest:', backtestError);
        return new Response(
          JSON.stringify({ error: 'Backtest not found' }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Get workflow configuration
      const { data: workflow, error: workflowError } = await supabaseClient
        .from('workflows')
        .select('*')
        .eq('id', backtest.workflow_id)
        .single();

      if (workflowError || !workflow) {
        console.error('Failed to fetch workflow:', workflowError);
        return new Response(
          JSON.stringify({ error: 'Workflow not found' }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        );
      }

      // Update backtest status to running
      await supabaseClient
        .from('backtests')
        .update({
          status: 'running',
          started_at: new Date().toISOString()
        })
        .eq('id', backtestId);

      // Run backtest asynchronously
      runBacktestAsync(supabaseClient, backtest, workflow);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Backtest execution started',
          backtestId: backtestId
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        status: 405, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in run-backtest function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function runBacktestAsync(supabaseClient: any, backtest: any, workflow: any) {
  try {
    console.log(`Running backtest for workflow: ${workflow.name}`);
    
    // Initialize portfolio
    const portfolio: Portfolio = {
      cash: backtest.initial_capital,
      positions: {},
      totalValue: backtest.initial_capital
    };

    // Extract symbols from workflow
    const symbols = extractSymbolsFromWorkflow(workflow);
    console.log(`Found symbols in workflow: ${symbols.join(', ')}`);

    if (symbols.length === 0) {
      throw new Error('No tradeable symbols found in workflow');
    }

    // Generate sample historical data (in production, you'd fetch real data)
    const historicalData = await generateSampleData(symbols, backtest.start_date, backtest.end_date);
    
    // Run simulation
    const { trades, snapshots, finalMetrics } = await simulateTrading(
      workflow,
      historicalData,
      portfolio,
      backtest
    );

    // Save results to database
    await saveBacktestResults(supabaseClient, backtest.id, trades, snapshots, finalMetrics);

    // Update backtest status to completed
    await supabaseClient
      .from('backtests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', backtest.id);

    console.log(`Backtest ${backtest.id} completed successfully`);

  } catch (error) {
    console.error(`Backtest ${backtest.id} failed:`, error);
    
    // Update backtest status to failed
    await supabaseClient
      .from('backtests')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error.message
      })
      .eq('id', backtest.id);
  }
}

function extractSymbolsFromWorkflow(workflow: any): string[] {
  const symbols = new Set<string>();
  
  if (workflow.nodes && Array.isArray(workflow.nodes)) {
    for (const node of workflow.nodes) {
      if (node.values?.symbol && typeof node.values.symbol === 'string') {
        symbols.add(node.values.symbol);
      }
    }
  }
  
  return Array.from(symbols);
}

async function generateSampleData(symbols: string[], startDate: string, endDate: string): Promise<MarketData[]> {
  const data: MarketData[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (const symbol of symbols) {
    let currentDate = new Date(start);
    let price = 100; // Starting price
    
    while (currentDate <= end) {
      // Skip weekends
      if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
        // Generate realistic price movement
        const change = (Math.random() - 0.5) * 0.04; // ±2% daily change
        price *= (1 + change);
        
        const dailyVolatility = 0.01;
        const open = price * (1 + (Math.random() - 0.5) * dailyVolatility);
        const close = price;
        const high = Math.max(open, close) * (1 + Math.random() * dailyVolatility);
        const low = Math.min(open, close) * (1 - Math.random() * dailyVolatility);
        
        data.push({
          date: currentDate.toISOString().split('T')[0],
          symbol,
          open,
          high,
          low,
          close,
          volume: Math.floor(Math.random() * 1000000) + 100000
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }
  
  return data.sort((a, b) => a.date.localeCompare(b.date));
}

async function simulateTrading(
  workflow: any, 
  historicalData: MarketData[], 
  portfolio: Portfolio, 
  backtest: any
) {
  const trades: any[] = [];
  const snapshots: any[] = [];
  const dailyData = groupDataByDate(historicalData);
  
  let previousPortfolioValue = portfolio.totalValue;
  let maxPortfolioValue = portfolio.totalValue;
  let maxDrawdown = 0;
  
  for (const date of Object.keys(dailyData).sort()) {
    const dayData = dailyData[date];
    
    // Simulate workflow execution with daily data
    const signals = executeWorkflowLogic(workflow, dayData);
    
    // Execute trades based on signals
    for (const signal of signals) {
      if (signal.action === 'buy' || signal.action === 'sell') {
        const trade = executeTrade(signal, portfolio, backtest, date);
        if (trade) {
          trades.push(trade);
        }
      }
    }
    
    // Calculate portfolio value
    portfolio.totalValue = calculatePortfolioValue(portfolio, dayData);
    
    // Track max drawdown
    if (portfolio.totalValue > maxPortfolioValue) {
      maxPortfolioValue = portfolio.totalValue;
    }
    const currentDrawdown = (maxPortfolioValue - portfolio.totalValue) / maxPortfolioValue;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
    
    // Create daily snapshot
    const stockValue = portfolio.totalValue - portfolio.cash;
    const dailyReturn = (portfolio.totalValue - previousPortfolioValue) / previousPortfolioValue;
    
    snapshots.push({
      date,
      total_value: portfolio.totalValue,
      cash_balance: portfolio.cash,
      stock_value: stockValue,
      daily_return: dailyReturn
    });
    
    previousPortfolioValue = portfolio.totalValue;
  }
  
  // Calculate final metrics
  const totalReturn = (portfolio.totalValue - backtest.initial_capital) / backtest.initial_capital;
  const profitableTrades = trades.filter(t => t.portfolio_value_after > t.portfolio_value_before).length;
  const winRate = trades.length > 0 ? profitableTrades / trades.length : 0;
  
  const finalMetrics = {
    total_return: totalReturn,
    final_portfolio_value: portfolio.totalValue,
    max_drawdown: maxDrawdown,
    total_trades: trades.length,
    profitable_trades: profitableTrades,
    win_rate: winRate,
    sharpe_ratio: calculateSharpeRatio(snapshots),
    annualized_return: totalReturn, // Simplified
    average_trade_return: trades.length > 0 ? trades.reduce((sum, t) => sum + ((t.portfolio_value_after - t.portfolio_value_before) / t.portfolio_value_before), 0) / trades.length : 0,
    largest_win: trades.length > 0 ? Math.max(...trades.map(t => (t.portfolio_value_after - t.portfolio_value_before) / t.portfolio_value_before)) : 0,
    largest_loss: trades.length > 0 ? Math.min(...trades.map(t => (t.portfolio_value_after - t.portfolio_value_before) / t.portfolio_value_before)) : 0
  };
  
  return { trades, snapshots, finalMetrics };
}

function groupDataByDate(data: MarketData[]): Record<string, MarketData[]> {
  return data.reduce((acc, item) => {
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {} as Record<string, MarketData[]>);
}

function executeWorkflowLogic(workflow: any, dayData: MarketData[]): any[] {
  const signals: any[] = [];
  
  // Simple logic: if we have AlpacaTrade nodes, simulate buy/sell signals
  if (workflow.nodes && Array.isArray(workflow.nodes)) {
    for (const node of workflow.nodes) {
      if (node.type === 'AlpacaTrade' && node.values) {
        const symbol = node.values.symbol || (dayData[0]?.symbol);
        if (symbol && Math.random() > 0.8) { // 20% chance of signal per day
          signals.push({
            action: node.values.side || 'buy',
            symbol: symbol,
            quantity: parseInt(node.values.qty) || 1,
            type: 'market'
          });
        }
      }
    }
  }
  
  return signals;
}

function executeTrade(signal: any, portfolio: Portfolio, backtest: any, date: string): any | null {
  const marketPrice = 100 + Math.random() * 50; // Simplified pricing
  const commission = backtest.commission_rate * signal.quantity * marketPrice;
  const slippage = backtest.slippage_rate * marketPrice;
  
  const portfolioValueBefore = portfolio.totalValue;
  
  if (signal.action === 'buy') {
    const totalCost = signal.quantity * (marketPrice + slippage) + commission;
    if (portfolio.cash >= totalCost) {
      portfolio.cash -= totalCost;
      if (!portfolio.positions[signal.symbol]) {
        portfolio.positions[signal.symbol] = { quantity: 0, avgPrice: 0 };
      }
      const currentPos = portfolio.positions[signal.symbol];
      const newTotalQuantity = currentPos.quantity + signal.quantity;
      const newAvgPrice = ((currentPos.quantity * currentPos.avgPrice) + (signal.quantity * marketPrice)) / newTotalQuantity;
      
      portfolio.positions[signal.symbol] = {
        quantity: newTotalQuantity,
        avgPrice: newAvgPrice
      };
    } else {
      return null; // Insufficient funds
    }
  } else if (signal.action === 'sell') {
    if (portfolio.positions[signal.symbol] && portfolio.positions[signal.symbol].quantity >= signal.quantity) {
      const proceeds = signal.quantity * (marketPrice - slippage) - commission;
      portfolio.cash += proceeds;
      portfolio.positions[signal.symbol].quantity -= signal.quantity;
      
      if (portfolio.positions[signal.symbol].quantity === 0) {
        delete portfolio.positions[signal.symbol];
      }
    } else {
      return null; // Insufficient shares
    }
  }
  
  portfolio.totalValue = calculatePortfolioValue(portfolio, [{ symbol: signal.symbol, close: marketPrice } as MarketData]);
  
  return {
    symbol: signal.symbol,
    action: signal.action,
    quantity: signal.quantity,
    price: marketPrice,
    commission: commission,
    slippage: slippage,
    timestamp: new Date(date).toISOString(),
    portfolio_value_before: portfolioValueBefore,
    portfolio_value_after: portfolio.totalValue
  };
}

function calculatePortfolioValue(portfolio: Portfolio, dayData: MarketData[]): number {
  let stockValue = 0;
  const priceMap = dayData.reduce((acc, data) => {
    acc[data.symbol] = data.close;
    return acc;
  }, {} as Record<string, number>);
  
  for (const [symbol, position] of Object.entries(portfolio.positions)) {
    const currentPrice = priceMap[symbol] || position.avgPrice;
    stockValue += position.quantity * currentPrice;
  }
  
  return portfolio.cash + stockValue;
}

function calculateSharpeRatio(snapshots: any[]): number {
  if (snapshots.length < 2) return 0;
  
  const returns = snapshots.slice(1).map(s => s.daily_return);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);
  
  return volatility > 0 ? avgReturn / volatility : 0;
}

async function saveBacktestResults(
  supabaseClient: any, 
  backtestId: string, 
  trades: any[], 
  snapshots: any[], 
  metrics: any
) {
  console.log(`Saving results for backtest ${backtestId}: ${trades.length} trades, ${snapshots.length} snapshots`);
  
  // Save backtest results
  const { error: resultsError } = await supabaseClient
    .from('backtest_results')
    .insert({
      backtest_id: backtestId,
      ...metrics
    });

  if (resultsError) {
    console.error('Error saving backtest results:', resultsError);
    throw resultsError;
  }

  // Save trades
  if (trades.length > 0) {
    const tradesWithBacktestId = trades.map(trade => ({
      ...trade,
      backtest_id: backtestId
    }));

    const { error: tradesError } = await supabaseClient
      .from('backtest_trades')
      .insert(tradesWithBacktestId);

    if (tradesError) {
      console.error('Error saving trades:', tradesError);
      throw tradesError;
    }
  }

  // Save portfolio snapshots
  if (snapshots.length > 0) {
    const snapshotsWithBacktestId = snapshots.map(snapshot => ({
      ...snapshot,
      backtest_id: backtestId
    }));

    const { error: snapshotsError } = await supabaseClient
      .from('backtest_portfolio_snapshots')
      .insert(snapshotsWithBacktestId);

    if (snapshotsError) {
      console.error('Error saving snapshots:', snapshotsError);
      throw snapshotsError;
    }
  }

  console.log(`Successfully saved all backtest results for ${backtestId}`);
}