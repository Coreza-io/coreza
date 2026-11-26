import { createErrorOutput, type NodeResult } from "../utils/nodeResultHelpers";
import { BacktestExecutor } from "./BacktestExecutor";
import { BacktestSessionManager } from "./session/BacktestSessionManager";

export async function runPreparedBacktest(init: NodeResult, signal?: AbortSignal): Promise<NodeResult> {
  if (init.status !== "success") return init;
  const backtestId = init.data.backtest_id;
  const manager = BacktestSessionManager.getInstance();
  const session = manager.getSession(backtestId);
  if (!session) return createErrorOutput("Prepared backtest session no longer exists");

  const cancel = () => session.cancel(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    let result: NodeResult;
    try {
      if (signal?.aborted) cancel();
      await session.runAll();
      signal?.throwIfAborted();
      result = {
        ...init,
        data: {
          ...init.data,
          status: "completed",
          data: { ...init.data.data, indicators_ready: session.indicatorsReadyAtStart },
        },
      };
    } catch (error) {
      if (session.persistResults) {
        await BacktestExecutor.recordBacktestFailure(backtestId, session.userId, signal);
      }
      result = createErrorOutput(error);
    }

    const ownedNodeResults = session.getLatestNodeSnapshots();
    result.control = {
      suppressRouting: true,
      ownedNodeResults,
      ownedExecutionOrder: Object.keys(ownedNodeResults),
    };
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
    manager.deleteSession(backtestId);
  }
}
