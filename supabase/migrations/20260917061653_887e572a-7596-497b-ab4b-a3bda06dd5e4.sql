REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_execution_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_current_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_execution_limit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_execution_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_current_usage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_execution_limit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO service_role;