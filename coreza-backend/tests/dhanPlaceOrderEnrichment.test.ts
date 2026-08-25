import axios, { AxiosResponse } from "axios";
import { BrokerExecutor } from "../src/nodes/executors/BrokerExecutor";
import { WorkflowNode } from "../src/nodes/types";
import CredentialManager from "../src/utils/credentialManager";
import { OrderOwnerRegistry } from "../src/services/OrderOwnerRegistry";
import {
  getOrderFromCache,
  updateOrderCache,
} from "../src/utils/orderIdempotency";

jest.mock("axios");
jest.mock("../src/utils/credentialManager", () => ({
  __esModule: true,
  default: {
    getCredentials: jest.fn(),
  },
}));
jest.mock("../src/services/OrderOwnerRegistry", () => ({
  OrderOwnerRegistry: {
    saveOwner: jest.fn(),
    deleteOwnerIds: jest.fn(),
  },
}));
jest.mock("../src/utils/orderIdempotency", () => ({
  claimOrderIntent: jest.fn().mockResolvedValue({ claimed: true }),
  cacheReconciledOrder: jest.fn().mockResolvedValue(true),
  generateIdempotencyKey: jest.fn().mockReturnValue("idem-1"),
  getOrderFromCache: jest.fn().mockResolvedValue(null),
  takeOverOrderIntent: jest.fn().mockResolvedValue(true),
  updateOrderCache: jest.fn().mockResolvedValue(undefined),
}));

type DelayOverride = {
  delay: (ms: number) => Promise<void>;
};

const mockedAxios = axios as jest.MockedFunction<typeof axios>;
const mockedCredentialManager = CredentialManager as jest.Mocked<
  typeof CredentialManager
>;
const mockedSaveOwner = OrderOwnerRegistry.saveOwner as jest.Mock;
const mockedGetOrderFromCache = getOrderFromCache as jest.Mock;
const mockedUpdateOrderCache = updateOrderCache as jest.Mock;

function axiosResponse<T>(data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: {} } as AxiosResponse<T>["config"],
  };
}

function createExecutor(): BrokerExecutor {
  const executor = new BrokerExecutor();
  jest
    .spyOn(executor as unknown as DelayOverride, "delay")
    .mockResolvedValue(undefined);
  return executor;
}

function buildNode(): WorkflowNode {
  return {
    id: "node-1",
    name: "DhanTrade",
    type: "broker",
    node_type: "main",
    category: "Broker",
    subCategory: "dhan",
    values: {
      credential_id: "cred-1",
      operation: "place_order",
      symbol: "HDFCBANK",
      quantity: 1,
      transactionType: "BUY",
      exchangeSegment: "NSE_EQ",
      orderType: "MARKET",
      productType: "INTRADAY",
      validity: "DAY",
    },
  };
}

describe("Dhan place_order enrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockedCredentialManager.getCredentials.mockResolvedValue({
      credentials: {
        client_json: {
          client_id: "client-1",
          api_key: "token-1",
        },
      },
    } as Awaited<ReturnType<typeof CredentialManager.getCredentials>>);
    mockedGetOrderFromCache.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("merges get_order_by_id details before owner save and idempotency cache", async () => {
    mockedAxios
      .mockResolvedValueOnce(
        axiosResponse({ orderId: "order-1", orderStatus: "TRANSIT" }),
      )
      .mockResolvedValueOnce(
        axiosResponse([{ orderId: "order-1", orderStatus: "TRANSIT" }]),
      )
      .mockResolvedValueOnce(
        axiosResponse([{ orderId: "order-1", orderStatus: "PENDING" }]),
      )
      .mockResolvedValueOnce(
        axiosResponse([
          {
            dhanClientId: "client-1",
            orderId: "order-1",
            exchangeOrderId: "exchange-1",
            correlationId: "idem-1",
            transactionType: "BUY",
            exchangeSegment: "NSE_EQ",
            orderStatus: "TRADED",
          },
        ]),
      );

    const result = await createExecutor().execute(
      buildNode(),
      {},
      {
        userId: "user-1",
        workflowId: "workflow-1",
        runId: "run-1",
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      orderId: "order-1",
      orderStatus: "TRADED",
      exchangeOrderId: "exchange-1",
      correlationId: "idem-1",
      transactionType: "BUY",
      exchangeSegment: "NSE_EQ",
    });
    expect(mockedAxios).toHaveBeenCalledTimes(4);
    expect(mockedAxios.mock.calls[1][0]).toMatchObject({
      method: "get",
      url: expect.stringContaining("/orders/order-1"),
    });
    expect(mockedSaveOwner).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        clientOrderId: "idem-1",
        exchangeOrderId: "exchange-1",
      }),
    );
    expect(mockedUpdateOrderCache).toHaveBeenCalledWith(
      "user-1",
      "workflow-1",
      "idem-1",
      expect.any(String),
      "success",
      expect.objectContaining({ exchangeOrderId: "exchange-1" }),
      "order-1",
    );
  });

  it("returns the minimal place response when enrichment fails", async () => {
    mockedAxios
      .mockResolvedValueOnce(
        axiosResponse({ orderId: "order-2", orderStatus: "TRANSIT" }),
      )
      .mockRejectedValue(new Error("Dhan detail unavailable"));

    const result = await createExecutor().execute(
      buildNode(),
      {},
      {
        userId: "user-1",
        workflowId: "workflow-1",
        runId: "run-1",
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ orderId: "order-2", orderStatus: "TRANSIT" });
    expect(mockedUpdateOrderCache).toHaveBeenCalledWith(
      "user-1",
      "workflow-1",
      "idem-1",
      "success",
      { orderId: "order-2", orderStatus: "TRANSIT" },
      "order-2",
    );
  });
});
