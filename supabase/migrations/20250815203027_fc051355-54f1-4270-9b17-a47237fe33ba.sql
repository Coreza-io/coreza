-- Create backtesting tables
CREATE TABLE public.backtests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  workflow_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  initial_capital DECIMAL(15,2) NOT NULL DEFAULT 10000.00,
  commission_rate DECIMAL(5,4) DEFAULT 0.001,
  slippage_rate DECIMAL(5,4) DEFAULT 0.001,
  data_frequency TEXT NOT NULL DEFAULT '1d',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT
);

-- Create backtest results table
CREATE TABLE public.backtest_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  backtest_id UUID NOT NULL,
  total_return DECIMAL(10,4),
  annualized_return DECIMAL(10,4),
  max_drawdown DECIMAL(10,4),
  sharpe_ratio DECIMAL(10,4),
  win_rate DECIMAL(5,4),
  total_trades INTEGER,
  profitable_trades INTEGER,
  average_trade_return DECIMAL(10,4),
  largest_win DECIMAL(10,4),
  largest_loss DECIMAL(10,4),
  final_portfolio_value DECIMAL(15,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create backtest trades table
CREATE TABLE public.backtest_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  backtest_id UUID NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL, -- 'buy' or 'sell'
  quantity DECIMAL(15,4) NOT NULL,
  price DECIMAL(15,4) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  commission DECIMAL(10,4),
  slippage DECIMAL(10,4),
  portfolio_value_before DECIMAL(15,2),
  portfolio_value_after DECIMAL(15,2),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create backtest portfolio snapshots table
CREATE TABLE public.backtest_portfolio_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  backtest_id UUID NOT NULL,
  date DATE NOT NULL,
  cash_balance DECIMAL(15,2) NOT NULL,
  stock_value DECIMAL(15,2) NOT NULL,
  total_value DECIMAL(15,2) NOT NULL,
  daily_return DECIMAL(10,4),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.backtests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Create policies for backtests
CREATE POLICY "Users can view their own backtests" 
ON public.backtests 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own backtests" 
ON public.backtests 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own backtests" 
ON public.backtests 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own backtests" 
ON public.backtests 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create policies for backtest results
CREATE POLICY "Users can view results of their own backtests" 
ON public.backtest_results 
FOR SELECT 
USING (auth.uid() IN (
  SELECT user_id FROM public.backtests WHERE id = backtest_results.backtest_id
));

CREATE POLICY "Users can create results for their own backtests" 
ON public.backtest_results 
FOR INSERT 
WITH CHECK (auth.uid() IN (
  SELECT user_id FROM public.backtests WHERE id = backtest_results.backtest_id
));

-- Create policies for backtest trades
CREATE POLICY "Users can view trades of their own backtests" 
ON public.backtest_trades 
FOR SELECT 
USING (auth.uid() IN (
  SELECT user_id FROM public.backtests WHERE id = backtest_trades.backtest_id
));

CREATE POLICY "Users can create trades for their own backtests" 
ON public.backtest_trades 
FOR INSERT 
WITH CHECK (auth.uid() IN (
  SELECT user_id FROM public.backtests WHERE id = backtest_trades.backtest_id
));

-- Create policies for portfolio snapshots
CREATE POLICY "Users can view portfolio snapshots of their own backtests" 
ON public.backtest_portfolio_snapshots 
FOR SELECT 
USING (auth.uid() IN (
  SELECT user_id FROM public.backtests WHERE id = backtest_portfolio_snapshots.backtest_id
));

CREATE POLICY "Users can create portfolio snapshots for their own backtests" 
ON public.backtest_portfolio_snapshots 
FOR INSERT 
WITH CHECK (auth.uid() IN (
  SELECT user_id FROM public.backtests WHERE id = backtest_portfolio_snapshots.backtest_id
));

-- Add foreign key constraints
ALTER TABLE public.backtest_results 
ADD CONSTRAINT fk_backtest_results_backtest_id 
FOREIGN KEY (backtest_id) REFERENCES public.backtests(id) ON DELETE CASCADE;

ALTER TABLE public.backtest_trades 
ADD CONSTRAINT fk_backtest_trades_backtest_id 
FOREIGN KEY (backtest_id) REFERENCES public.backtests(id) ON DELETE CASCADE;

ALTER TABLE public.backtest_portfolio_snapshots 
ADD CONSTRAINT fk_backtest_portfolio_snapshots_backtest_id 
FOREIGN KEY (backtest_id) REFERENCES public.backtests(id) ON DELETE CASCADE;

-- Create indexes for better performance
CREATE INDEX idx_backtests_user_id ON public.backtests(user_id);
CREATE INDEX idx_backtests_workflow_id ON public.backtests(workflow_id);
CREATE INDEX idx_backtest_results_backtest_id ON public.backtest_results(backtest_id);
CREATE INDEX idx_backtest_trades_backtest_id ON public.backtest_trades(backtest_id);
CREATE INDEX idx_backtest_trades_symbol ON public.backtest_trades(symbol);
CREATE INDEX idx_backtest_portfolio_snapshots_backtest_id ON public.backtest_portfolio_snapshots(backtest_id);
CREATE INDEX idx_backtest_portfolio_snapshots_date ON public.backtest_portfolio_snapshots(date);