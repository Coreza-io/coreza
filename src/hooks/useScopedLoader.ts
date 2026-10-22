import { useCallback, useEffect, useMemo, useRef } from "react";

/** One active load and at most one requested reconciliation per owner/document scope. */
export function useScopedLoader(scopeKey: string, load: (isCurrent: () => boolean) => Promise<void>) {
  const scope = useMemo(() => ({}), [scopeKey]);
  const currentScope = useRef<object | null>(scope);
  currentScope.current = scope;
  const flightRef = useRef<{ scope: object; queued: boolean; promise: Promise<void> } | null>(null);
  useEffect(() => {
    currentScope.current = scope;
    return () => { if (currentScope.current === scope) currentScope.current = null; };
  }, [scope]);
  return useCallback(() => {
    if (currentScope.current !== scope) return Promise.resolve();
    const previous = flightRef.current;
    if (previous?.scope === scope) { previous.queued = true; return previous.promise; }
    const flight = { scope, queued: false, promise: Promise.resolve() };
    flightRef.current = flight;
    flight.promise = (async () => {
      try {
        do {
          flight.queued = false;
          await load(() => currentScope.current === scope);
        } while (flight.queued && currentScope.current === scope);
      } finally { if (flightRef.current === flight) flightRef.current = null; }
    })();
    return flight.promise;
  }, [scope, load]);
}
