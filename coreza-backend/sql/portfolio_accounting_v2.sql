-- Deployment source, NOT an applied migration. Inventory deployed schema first,
-- generate a migration with the Supabase CLI, then review/apply separately.
-- Service backend only. Reporting tables remain unchanged.
BEGIN;
CREATE TABLE public.portfolio_accounting_books (
  book_key text PRIMARY KEY,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id),
  activation_id uuid NOT NULL REFERENCES public.live_strategies(id),
  scope jsonb NOT NULL,
  owner_token uuid NOT NULL,
  active_account boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL CHECK (revision >= 0),
  calculation_version integer NOT NULL CHECK (calculation_version = 2),
  checkpoint jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workflow_id, activation_id, scope)
);
-- Exclusive account admission persists until an explicit reconciled handover.
CREATE UNIQUE INDEX portfolio_accounting_exclusive_account ON public.portfolio_accounting_books
  ((scope->>'broker'),(scope->>'environment'),(scope->>'accountId')) WHERE active_account;
CREATE TABLE public.portfolio_accounting_events (
  book_key text NOT NULL REFERENCES public.portfolio_accounting_books(book_key),
  event_id text NOT NULL,
  revision bigint NOT NULL,
  owner_token uuid NOT NULL,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  reported_at timestamptz,
  PRIMARY KEY (book_key, event_id),
  UNIQUE (book_key, revision)
);
CREATE TABLE public.portfolio_accounting_failures (
  book_key text NOT NULL REFERENCES public.portfolio_accounting_books(book_key),
  evidence_id text NOT NULL,
  payload jsonb NOT NULL,
  reason text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_key,evidence_id)
);
ALTER TABLE public.portfolio_accounting_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portfolio_accounting_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.portfolio_accounting_failures TO service_role;
ALTER TABLE public.portfolio_accounting_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio_accounting_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portfolio_accounting_books, public.portfolio_accounting_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE (revision,checkpoint,updated_at) ON public.portfolio_accounting_books TO service_role;
GRANT SELECT, INSERT, UPDATE (reported_at) ON public.portfolio_accounting_events TO service_role;
CREATE INDEX portfolio_accounting_unreported ON public.portfolio_accounting_events(accepted_at,book_key,revision) WHERE reported_at IS NULL;

CREATE FUNCTION public.portfolio_accounting_open(p_key text, p_owner uuid, p_book jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.portfolio_accounting_books;
BEGIN
  IF p_book->>'version' IS DISTINCT FROM '2' OR p_book->>'revision' IS DISTINCT FROM '0' OR
     NOT EXISTS (SELECT 1 FROM public.live_strategies s WHERE s.id=(p_book->'scope'->>'activationId')::uuid
       AND s.user_id=(p_book->'scope'->>'userId')::uuid AND s.workflow_id=(p_book->'scope'->>'workflowId')::uuid AND s.mode='live') THEN
    RAISE EXCEPTION 'Invalid accounting activation ownership/version';
  END IF;
  INSERT INTO public.portfolio_accounting_books(book_key,user_id,workflow_id,activation_id,scope,owner_token,revision,calculation_version,checkpoint)
    VALUES(p_key,(p_book->'scope'->>'userId')::uuid,(p_book->'scope'->>'workflowId')::uuid,
      (p_book->'scope'->>'activationId')::uuid,p_book->'scope',p_owner,0,2,p_book)
    ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT b FROM public.portfolio_accounting_books WHERE book_key=p_key FOR UPDATE;
  IF NOT b.active_account OR b.scope IS DISTINCT FROM p_book->'scope' OR b.owner_token IS DISTINCT FROM p_owner THEN
    RAISE EXCEPTION 'recovering: ownership transfer requires broker reconciliation and approved recovery';
  END IF;
  RETURN b.checkpoint;
END $$;

CREATE FUNCTION public.portfolio_accounting_commit(p_key text, p_owner uuid, p_expected bigint,
  p_book jsonb, p_event_id text, p_fingerprint text, p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b public.portfolio_accounting_books; e public.portfolio_accounting_events;
BEGIN
  SELECT * INTO STRICT b FROM public.portfolio_accounting_books WHERE book_key=p_key FOR UPDATE;
  IF NOT b.active_account OR b.owner_token IS DISTINCT FROM p_owner OR b.calculation_version<>2 OR b.scope IS DISTINCT FROM p_book->'scope' THEN
    RAISE EXCEPTION 'Accounting owner fence/scope/version mismatch';
  END IF;
  SELECT * INTO e FROM public.portfolio_accounting_events WHERE book_key=p_key AND event_id=p_event_id;
  IF FOUND THEN
    IF e.fingerprint IS DISTINCT FROM p_fingerprint OR e.payload IS DISTINCT FROM p_event THEN
      RAISE EXCEPTION 'Immutable accounting event identity conflict';
    END IF;
    RETURN b.checkpoint;
  END IF;
  IF b.revision<>p_expected OR (p_book->>'revision')::bigint<>p_expected+1 OR p_book->>'version' IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'Accounting revision conflict';
  END IF;
  INSERT INTO public.portfolio_accounting_events(book_key,event_id,revision,owner_token,fingerprint,payload)
    VALUES(p_key,p_event_id,p_expected+1,p_owner,p_fingerprint,p_event);
  UPDATE public.portfolio_accounting_books SET revision=p_expected+1, checkpoint=p_book, updated_at=now() WHERE book_key=p_key;
  RETURN p_book;
END $$;
REVOKE ALL ON FUNCTION public.portfolio_accounting_open(text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.portfolio_accounting_commit(text,uuid,bigint,jsonb,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portfolio_accounting_open(text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.portfolio_accounting_commit(text,uuid,bigint,jsonb,text,text,jsonb) TO service_role;
COMMIT;
