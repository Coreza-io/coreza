import { useCallback, useEffect, useRef, useState, type FocusEvent } from "react";

const LEAVE_DELAY_MS = 150;
// Only the old and new toolbar update when crossing edges; the graph never re-renders.
const activeToolbars = new Map<string, { owner: symbol; close: () => void; hasFocus: () => boolean }>();

/** Local ownership spans the SVG hit path and the portaled toolbar. */
export function useEdgeToolbarHover(identity: string, enabled: boolean, canEdit: () => boolean, scope = identity) {
  const [visibleFor, setVisibleFor] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const owners = useRef({ edge: false, toolbar: false, focus: false });
  const ownerToken = useRef(Symbol());
  const release = useCallback(() => {
    if (activeToolbars.get(scope)?.owner === ownerToken.current) activeToolbars.delete(scope);
  }, [scope]);
  const latest = useRef({ identity, enabled, canEdit });
  latest.current = { identity, enabled, canEdit };
  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const close = useCallback(() => {
    clearTimer();
    owners.current = { edge: false, toolbar: false, focus: false };
    release();
    setVisibleFor(null);
  }, [clearTimer, release]);
  useEffect(() => {
    close();
    return () => { clearTimer(); release(); };
  }, [identity, enabled, close, clearTimer, release]);

  const enter = (owner: keyof typeof owners.current) => {
    if (!latest.current.enabled || !latest.current.canEdit()) { close(); return; }
    const active = activeToolbars.get(scope);
    if (active && active.owner !== ownerToken.current) {
      if (active.hasFocus()) return;
      active.close();
    }
    activeToolbars.set(scope, { owner: ownerToken.current, close, hasFocus: () => owners.current.focus });
    clearTimer();
    owners.current[owner] = true;
    setVisibleFor(latest.current.identity);
  };
  const leave = (owner: keyof typeof owners.current) => {
    owners.current[owner] = false;
    clearTimer();
    const currentIdentity = identity;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (latest.current.identity !== currentIdentity) return;
      if (!latest.current.enabled || !latest.current.canEdit() || !Object.values(owners.current).some(Boolean)) close();
    }, LEAVE_DELAY_MS);
  };
  return {
    visible: visibleFor === identity && enabled && canEdit(),
    close,
    onEdgeEnter: () => enter("edge"),
    onEdgeLeave: () => leave("edge"),
    onToolbarEnter: () => enter("toolbar"),
    onToolbarLeave: () => leave("toolbar"),
    onFocus: () => enter("focus"),
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) leave("focus");
    },
  };
}
