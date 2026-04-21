const { PortfolioExecutor } = require("../src/nodes/executors/PortfolioExecutor");
const { FillEventBus } = require("../src/services/FillEventBus");

describe("PortfolioExecutor algo lifecycle", () => {
  it("publishes algo lifecycle rows that upsert by algo id and carry engine order id", async () => {
    const publishSpy = jest
      .spyOn(FillEventBus, "publish")
      .mockResolvedValue(undefined);

    const executor = new PortfolioExecutor();
    const node = {
      id: "portfolio-1",
      name: "Portfolio",
      node_type: "portfolio",
      values: {
        mode: "broker",
        operation: "sync_order_event",
        broker: "binance",
        symbol: "BTCUSDT",
        side: "sell",
      },
    };

    const context = {
      userId: "user-1",
      executionId: "run-1",
      workflowId: "wf-1",
      nodeId: "portfolio-1",
      nodes: [],
      edges: [],
      resolvedParams: {},
      resolveNodeParameters: (n, input) => ({ ...n.values, ...input }),
      getAllNodeResults: () => ({}),
      checkCancellation: () => false,
      executionMode: "live",
      getState: () => undefined,
      setState: () => undefined,
    };

    for (const status of ["UNTRIGGERED", "TRIGGERING", "TRIGGERED", "FINISHED"]) {
      const result = await executor.execute(
        node,
        {
          type: "algo_update",
          algoId: "algo-1",
          symbol: "BTCUSDT",
          side: "sell",
          triggerPrice: 60000,
          engineOrderId: status === "TRIGGERED" || status === "FINISHED" ? "ord-10" : undefined,
          algoStatus: status,
        },
        context,
      );
      expect(result.success).toBe(true);
    }

    expect(publishSpy).toHaveBeenCalledTimes(4);
    const lastPayload = publishSpy.mock.calls[publishSpy.mock.calls.length - 1][0];
    expect(lastPayload).toMatchObject({
      fill_id: "algo-1",
      algo_id: "algo-1",
      fill_status: "finished",
      order_id: "ord-10",
      fill_qty_delta: 0,
    });

    publishSpy.mockRestore();
  });
});
