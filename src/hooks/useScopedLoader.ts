import { useCallback, useEffect, useMemo, useRef } from "react";

/** One active load and at most one requested reconciliation per owner/document scope. */
export function useScopedLoader(scopeKey: string, load: (isCurrent: () => boolean) => Promise<void>) {
  const scope = useMemo(() => ({}), [scopeKey]);
  const ownerRef = useRef({ scope, live: true });
  if (ownerRef.current.scope !== scope) ownerRef.current = { scope, live: true };
  const flightRef = useRef<{ owner: typeof ownerRef.current; queued: boolean; promise: Promise<void> } | null>(null);
  useEffect(() => {
    if (!ownerRef.current.live || ownerRef.current.scope !== scope) ownerRef.current = { scope, live: true };
    const owner = ownerRef.current;
    return () => { owner.live = false; };
  }, [scope]);
  return useCallback(() => {
    const owner = ownerRef.current;
    const isCurrent = () => ownerRef.current === owner && owner.live && owner.scope === scope;
    if (!isCurrent()) return Promise.resolve();
    const previous = flightRef.current;
    if (previous?.owner === owner) { previous.queued = true; return previous.promise; }
    const flight = { owner, queued: false, promise: Promise.resolve() };
    flightRef.current = flight;
    flight.promise = (async () => {
      try {
        do {
          flight.queued = false;
          await load(isCurrent);
        } while (flight.queued && isCurrent());
      } finally { if (flightRef.current === flight) flightRef.current = null; }
    })();
    return flight.promise;
  }, [scope, load]);
}
