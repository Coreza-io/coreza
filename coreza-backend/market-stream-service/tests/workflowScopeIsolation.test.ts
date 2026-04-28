import { MarketControlHandler } from "../src/services/MarketControlHandler";
import { MarketDataSubscriber } from "../src/services/MarketDataSubscriber";

jest.mock("../src/config/redis", () => ({
  createRedisPubSub: () => ({
    pub: {
      keys: jest.fn().mockResolvedValue([]),
      smembers: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
      srem: jest.fn().mockResolvedValue(1),
    },
    sub: {
      subscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    },
  }),
}));

describe("workflow-scoped update isolation", () => {
  it("does not fan out updates to all workflows when target is missing", async () => {
    const addStreamsToRegistration = jest.fn().mockResolvedValue(undefined);
    const addAllowedSymbolsToRegistration = jest
      .fn()
      .mockResolvedValue(undefined);
    const getRegisteredWorkflowIdsForUser = jest
      .fn()
      .mockReturnValue(["wf-A", "wf-B"]);

    jest
      .spyOn(MarketDataSubscriber, "getInstance")
      .mockReturnValue(
        {
          addStreamsToRegistration,
          addAllowedSymbolsToRegistration,
          getRegisteredWorkflowIdsForUser,
        } as unknown as MarketDataSubscriber,
      );

    const handler = MarketControlHandler.getInstance() as any;

    await handler.updateActiveStreamingWorkflows(
      "user-1",
      ["bars.AAPL"],
      ["AAPL"],
      "workflow",
      "wf-missing",
      [],
    );

    expect(addStreamsToRegistration).toHaveBeenCalledTimes(1);
    expect(addStreamsToRegistration).toHaveBeenCalledWith(
      "wf-missing",
      ["bars.AAPL"],
      [],
    );
    expect(addAllowedSymbolsToRegistration).toHaveBeenCalledTimes(1);
    expect(addAllowedSymbolsToRegistration).toHaveBeenCalledWith(
      "wf-missing",
      ["AAPL"],
    );
  });
});
