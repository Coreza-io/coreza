REVOKE ALL ON TABLE public.workflow_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_runs TO authenticated;
GRANT ALL ON TABLE public.workflow_runs TO service_role;