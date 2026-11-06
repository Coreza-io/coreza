import { useEffect, useRef } from "react";

interface Options {
  canSave: () => boolean;
  hasUnsavedChanges: () => boolean;
  onSave: () => void | Promise<unknown>;
}

/** Background saves use the current document and its canonical dirty check. */
export function useWorkflowVisibilitySave(options: Options) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      const current = latest.current;
      if (current.canSave() && current.hasUnsavedChanges()) {
        void current.onSave();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);
}
