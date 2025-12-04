-- Create subscription tier enum
CREATE TYPE public.subscription_tier AS ENUM ('free', 'trader', 'professional', 'enterprise');

-- Create subscription status enum
CREATE TYPE public.subscription_status AS ENUM ('active', 'cancelled', 'expired', 'trial');

-- Create subscriptions table
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  tier subscription_tier NOT NULL DEFAULT 'free',
  status subscription_status NOT NULL DEFAULT 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz NOT NULL DEFAULT (now() + interval '1 month'),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create usage_metrics table
CREATE TABLE public.usage_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL DEFAULT date_trunc('month', now())::date,
  period_end date NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
  execution_count integer DEFAULT 0,
  overage_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, period_start)
);

-- Enable RLS on both tables
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policies for subscriptions
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to subscriptions"
  ON public.subscriptions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- RLS policies for usage_metrics
CREATE POLICY "Users can view own usage"
  ON public.usage_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to usage_metrics"
  ON public.usage_metrics FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to increment execution count (atomic)
CREATE OR REPLACE FUNCTION public.increment_execution_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count integer;
BEGIN
  INSERT INTO usage_metrics (user_id, period_start, period_end, execution_count)
  VALUES (
    p_user_id,
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
    1
  )
  ON CONFLICT (user_id, period_start)
  DO UPDATE SET 
    execution_count = usage_metrics.execution_count + 1,
    updated_at = now()
  RETURNING execution_count INTO current_count;
  
  RETURN current_count;
END;
$$;

-- Function to get current usage
CREATE OR REPLACE FUNCTION public.get_current_usage(p_user_id uuid)
RETURNS TABLE(execution_count integer, period_start date, period_end date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT um.execution_count, um.period_start, um.period_end
  FROM usage_metrics um
  WHERE um.user_id = p_user_id
    AND um.period_start = date_trunc('month', now())::date;
END;
$$;

-- Function to check if user is within execution limit
CREATE OR REPLACE FUNCTION public.check_execution_limit(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_tier subscription_tier;
  current_count integer;
  tier_limit integer;
BEGIN
  -- Get user's tier
  SELECT tier INTO user_tier
  FROM subscriptions
  WHERE user_id = p_user_id;
  
  -- Default to free tier if no subscription
  IF user_tier IS NULL THEN
    user_tier := 'free';
  END IF;
  
  -- Set limits per tier
  tier_limit := CASE user_tier
    WHEN 'free' THEN 100
    WHEN 'trader' THEN 5000
    WHEN 'professional' THEN 50000
    WHEN 'enterprise' THEN 999999999
  END;
  
  -- Get current count
  SELECT COALESCE(um.execution_count, 0) INTO current_count
  FROM usage_metrics um
  WHERE um.user_id = p_user_id
    AND um.period_start = date_trunc('month', now())::date;
  
  IF current_count IS NULL THEN
    current_count := 0;
  END IF;
  
  RETURN current_count < tier_limit;
END;
$$;

-- Function to get user subscription tier
CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id uuid)
RETURNS subscription_tier
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_tier subscription_tier;
BEGIN
  SELECT tier INTO user_tier
  FROM subscriptions
  WHERE user_id = p_user_id
    AND status = 'active';
  
  RETURN COALESCE(user_tier, 'free');
END;
$$;

-- Trigger to update updated_at
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_usage_metrics_updated_at
  BEFORE UPDATE ON public.usage_metrics
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();