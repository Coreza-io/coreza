CREATE OR REPLACE FUNCTION public.get_current_usage(p_user_id uuid)
RETURNS public.usage_metrics
LANGUAGE plpgsql
AS $$
DECLARE
  v_period_start date := date_trunc('month', now())::date;
  v_period_end date := (date_trunc('month', now()) + interval '1 month - 1 day')::date;
  v_usage public.usage_metrics%ROWTYPE;
BEGIN
  INSERT INTO public.usage_metrics (user_id, period_start, period_end)
  VALUES (p_user_id, v_period_start, v_period_end)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  SELECT *
  INTO v_usage
  FROM public.usage_metrics
  WHERE user_id = p_user_id
    AND period_start = v_period_start;

  RETURN v_usage;
END;
$$;


CREATE OR REPLACE FUNCTION public.increment_execution_count(p_user_id uuid)
RETURNS public.usage_metrics
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier text;
  v_limit integer;
  v_period_start date := date_trunc('month', now())::date;
  v_period_end date := (date_trunc('month', now()) + interval '1 month - 1 day')::date;
  v_usage public.usage_metrics%ROWTYPE;
BEGIN
  SELECT tier
  INTO v_tier
  FROM public.subscriptions
  WHERE user_id = p_user_id
    AND status IN ('active', 'trial')
  LIMIT 1;

  v_tier := COALESCE(v_tier, 'free');

  v_limit := CASE v_tier
    WHEN 'free' THEN 100
    WHEN 'trader' THEN 5000
    WHEN 'professional' THEN 25000
    WHEN 'enterprise' THEN NULL
  END;

  WITH upserted AS (
    INSERT INTO public.usage_metrics (
      user_id,
      period_start,
      period_end,
      execution_count,
      overage_count,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      v_period_start,
      v_period_end,
      1,
      CASE WHEN v_limit IS NOT NULL AND 1 > v_limit THEN 1 ELSE 0 END,
      now(),
      now()
    )
    ON CONFLICT (user_id, period_start) DO UPDATE
    SET execution_count = public.usage_metrics.execution_count + 1,
        overage_count = public.usage_metrics.overage_count
          + CASE WHEN v_limit IS NOT NULL AND public.usage_metrics.execution_count + 1 > v_limit THEN 1 ELSE 0 END,
        updated_at = now()
    RETURNING *
  )
  SELECT * INTO v_usage FROM upserted;

  RETURN v_usage;
END;
$$;


CREATE OR REPLACE FUNCTION public.check_execution_limit(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_usage public.usage_metrics%ROWTYPE;
  v_tier text;
  v_limit integer;
BEGIN
  v_usage := public.get_current_usage(p_user_id);

  SELECT tier
  INTO v_tier
  FROM public.subscriptions
  WHERE user_id = p_user_id
    AND status IN ('active', 'trial')
  LIMIT 1;

  v_tier := COALESCE(v_tier, 'free');

  v_limit := CASE v_tier
    WHEN 'free' THEN 100
    WHEN 'trader' THEN 5000
    WHEN 'professional' THEN 25000
    WHEN 'enterprise' THEN NULL
  END;

  IF v_limit IS NULL THEN
    RETURN TRUE;
  END IF;

  RETURN v_usage.execution_count < v_limit;
END;
$$;
