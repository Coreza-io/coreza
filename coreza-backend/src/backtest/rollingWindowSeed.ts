import { DataContextManager } from "../engine/DataContext";
import { RollingWindow } from "../engine/RollingWindow";
import {
  clampWindowSize,
  normalizeSymbol,
  normalizeTimeframe,
} from "../engine/rollingWindowHelpers";
import { buildExecutionScopedKey } from "../utils/executionKey";

export interface RollingWindowSeed {
  size: number;
  interval: string;
  symbols: readonly string[];
  warmupBarsBySymbol: ReadonlyMap<string, readonly unknown[]>;
}

export interface RollingWindowDefinition {
  nodeId: string;
  params: Record<string, unknown>;
}

export function resolveRollingWindowSeedSize(
  windows: readonly RollingWindowDefinition[],
): number | undefined {
  const sizes = new Set<number>();

  for (const window of windows) {
    if (Object.keys(window.params).length === 0) {
      throw new Error(
        `RollingWindow node ${window.nodeId} has no configuration; re-save the workflow`,
      );
    }

    const rawSize = window.params.size;
    const isNumeric =
      (typeof rawSize === "number" && Number.isFinite(rawSize)) ||
      (typeof rawSize === "string" &&
        rawSize.trim() !== "" &&
        Number.isFinite(Number(rawSize)));
    if (!isNumeric) {
      console.warn(
        `[BacktestInit] RollingWindow ${window.nodeId} has a non-numeric Window Size; using the default size.`,
      );
    }
    sizes.add(clampWindowSize(rawSize));
  }

  if (sizes.size > 1) {
    const declaredSizes = [...sizes].sort((a, b) => a - b).join(", ");
    throw new Error(
      `Conflicting RollingWindow sizes (${declaredSizes}) for the same symbol/timeframe. All RollingWindow set nodes in a backtest must declare the same Window Size.`,
    );
  }

  return sizes.values().next().value;
}

interface SeedRollingWindowsOptions extends RollingWindowSeed {
  userId: string;
  workflowId: string;
  executionId: string;
}

export function seedRollingWindows({
  userId,
  workflowId,
  executionId,
  symbols,
  interval,
  size,
  warmupBarsBySymbol,
}: SeedRollingWindowsOptions): number {
  const dataContext = DataContextManager.getInstance().getContext({
    executionId,
    workflowId,
    userId,
  });
  const seededKeys = new Set<string>();

  for (const symbol of symbols) {
    const warmupBars = warmupBarsBySymbol.get(symbol) ?? [];
    if (warmupBars.length === 0) continue;

    const key = buildExecutionScopedKey({
      userId,
      workflowId,
      runId: executionId,
      scope: "rolling_window",
      parts: [normalizeSymbol(symbol), normalizeTimeframe(interval)],
    });
    const window = new RollingWindow<unknown>(size);
    for (const bar of warmupBars.slice(-size)) window.add(bar);
    dataContext.setData(key, window);
    seededKeys.add(key);
  }

  return seededKeys.size;
}
