import { useMemo } from "react";
import { useStableNodes } from "@/contexts/StableNodeContext";
import { useExecutionSourceVersions } from "@/contexts/ExecutionStoreContext";
import { resolveNodeIdentity, type ReferenceNode } from "@/utils/referenceResolution";

const NODE_REFERENCE = /(?:\$node\s*\[\s*["']([^"']+)["']\s*\]|\$\(\s*["']([^"']+)["']\s*\))/g;

/** Explicit literal references use keyed subscriptions; dynamic references keep a scoped fallback. */
export function useReferenceVersions(value: unknown, sourceId?: string, referenceNodes?: readonly ReferenceNode[]): string {
  const { getNodes } = useStableNodes();
  const ids = useMemo(() => {
    const ids = new Set(sourceId ? [sourceId] : []);
    const inventory = referenceNodes ?? getNodes();
    let remaining = 5000;
    let dynamic = false;
    const inspect = (item: unknown, depth: number) => {
      if (--remaining < 0 || depth > 32) { dynamic = true; return; }
      if (typeof item === "string") {
        for (const match of item.matchAll(NODE_REFERENCE)) {
          const node = resolveNodeIdentity(match[1] ?? match[2], inventory);
          if (!node) { dynamic = true; return; }
          ids.add(node.id);
        }
        if (/\$node|\$nodes|\$\(/.test(item.replace(NODE_REFERENCE, ""))) dynamic = true;
      } else if (Array.isArray(item)) {
        for (const child of item) { inspect(child, depth + 1); if (dynamic) break; }
      } else if (item && typeof item === "object") {
        for (const key in item) { if (Object.prototype.hasOwnProperty.call(item, key)) inspect((item as Record<string, unknown>)[key], depth + 1); if (dynamic) break; }
      }
    };
    try { inspect(value, 0); return dynamic ? null : [...ids]; } catch { return null; }
  }, [value, sourceId, referenceNodes, getNodes]);
  return useExecutionSourceVersions(ids);
}
