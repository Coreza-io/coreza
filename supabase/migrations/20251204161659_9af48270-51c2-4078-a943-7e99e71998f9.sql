-- Update the handle_new_user function to also create a subscription
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Create user profile
  INSERT INTO public.users (user_id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );
  
  -- Create free subscription for new user
  INSERT INTO public.subscriptions (user_id, tier, status)
  VALUES (
    NEW.id,
    'free',
    'active'
  );
  
  RETURN NEW;
END;
$$;