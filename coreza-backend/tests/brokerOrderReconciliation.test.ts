import axios, { AxiosError, type AxiosResponse } from "axios";
import type { WorkflowNode } from "../src/nodes/types";

const orderState = {
  cached: null as null | {
    idempotencyKey: string;
    status: "pending" | "success" | "failed";
    createdAt: string;
    updatedAt: string;
    ownerToken: string;
    broker: string;
    orderKind: "standard" | "algo";
    marketType: string;
    result?: unknown;
  },
};
const claimOrderIntent = jest.fn(async (_user: string, _workflow: string, key: string, broker: string, owner: string) => {
  if (orderState.cached) return { claimed: false as const, existing: orderState.cached };
  const now = new Date().toISOString();
  orderState.cached = { idempotencyKey: key, status: "pending", createdAt: now, updatedAt: now, ownerToken: owner, broker, orderKind: "standard", marketType: "unknown" };
  return { claimed: true as const };
});
const updateOrderCache = jest.fn(async (_user: string, _workflow: string, _key: string, owner: string, status: "pending" | "success" | "failed", result: unknown) => {
  if (!orderState.cached || orderState.cached.ownerToken !== owner) return false;
  orderState.cached = { ...orderState.cached, status, result, updatedAt: new Date().toISOString() };
  return true;
});
const cacheReconciledOrder = jest.fn(async (..._args: unknown[]) => true);
const releaseOrderClaim = jest.fn(async (..._args: unknown[]) => {
  orderState.cached = null;
  return true;
});
type CredentialResult = { credentials: { client_json: { api_key: string; secret_key: string } } | null };
const getCredentials = jest.fn(async (..._args: unknown[]): Promise<CredentialResult> => ({
  credentials: { client_json: { api_key: "key", secret_key: "secret" } },
}));

jest.mock("axios");
jest.mock("../src/brokers/dhan/scripMaster", () => ({}));
jest.mock("../src/utils/credentialManager", () => ({
  __esModule: true,
  default: { getCredentials: (...args: unknown[]) => getCredentials(...args) },
}));
jest.mock("../src/services/OrderOwnerRegistry", () => ({
  OrderOwnerRegistry: { saveOwner: jest.fn(), deleteOwnerIds: jest.fn() },
}));
jest.mock("../src/utils/orderIdempotency", () => ({
  generateIdempotencyKey: jest.fn(() => "idempotency-key"),
  getOrderFromCache: jest.fn(async () => orderState.cached),
  claimOrderIntent: (...args: unknown[]) => claimOrderIntent(...args as Parameters<typeof claimOrderIntent>),
  updateOrderCache: (...args: unknown[]) => updateOrderCache(...args as Parameters<typeof updateOrderCache>),
  cacheReconciledOrder: (...args: unknown[]) => cacheReconciledOrder(...args),
  takeOverOrderIntent: jest.fn(async () => true),
  releaseOrderClaim: (...args: unknown[]) => releaseOrderClaim(...args),
}));

import { BrokerExecutor } from "../src/nodes/executors/BrokerExecutor";

const mockedAxios = axios as jest.MockedFunction<typeof axios>;
const node: WorkflowNode = {
  id: "broker-node",
  name: "AlpacaTrade",
  node_type: "main",
  category: "Broker",
  subCategory: "alpaca",
  values: {
    credential_id: "credential",
    operation: "place_order",
    symbol: "SPY",
    side: "buy",
    qty: 1,
    type: "market",
    time_in_force: "day",
  },
};
const context = { userId: "user", workflowId: "workflow", runId: "run" };

function response(data: unknown): AxiosResponse {
  return { data, status: 200, statusText: "OK", headers: {}, config: { headers: {} } as AxiosResponse["config"] };
}

function requestMethod(request: unknown): unknown {
  return request !== null && typeof request === "object" && "method" in request
    ? request.method
    : undefined;
}

describe("atomic order idempotency", () => {
  beforeEach(() => {
    orderState.cached = null;
    jest.clearAllMocks();
    getCredentials.mockResolvedValue({ credentials: { client_json: { api_key: "key", secret_key: "secret" } } });
    jest.mocked(axios.isAxiosError).mockImplementation((error: unknown) => error instanceof AxiosError);
  });

  it("lets only one of 20 concurrent workers submit", async () => {
    mockedAxios.mockImplementation(async (request) => response({
      id: "order-1",
      client_order_id: "idempotency-key",
      method: requestMethod(request),
    }));
    const results = await Promise.all(Array.from({ length: 20 }, () => new BrokerExecutor().execute(node, {}, context)));

    expect(results.every((result) => result.success)).toBe(true);
    expect(mockedAxios.mock.calls.filter(([request]) =>
      requestMethod(request) === "post")).toHaveLength(1);
    expect(claimOrderIntent).toHaveBeenCalledTimes(20);
  });

  it("reconciles an unknown outcome by client order id without resubmitting", async () => {
    mockedAxios.mockRejectedValueOnce(new AxiosError("timeout", "ETIMEDOUT"));
    const first = await new BrokerExecutor().execute(node, {}, context);
    expect(first.success).toBe(false);
    expect(orderState.cached?.status).toBe("pending");

    mockedAxios.mockResolvedValueOnce(response({ id: "order-1", client_order_id: "idempotency-key" }));
    const second = await new BrokerExecutor().execute(node, {}, context);

    expect(second).toMatchObject({ success: true, data: { id: "order-1" }, meta: { reconciled: true } });
    expect(mockedAxios).toHaveBeenCalledTimes(2);
    expect(cacheReconciledOrder).toHaveBeenCalledTimes(1);
    expect(mockedAxios.mock.calls[1][0]).toMatchObject({
      method: "get",
      url: expect.stringContaining("orders:by_client_order_id"),
      params: { client_order_id: "idempotency-key" },
    });
  });

  it("returns the canonical outcome when success-cache ownership is lost", async () => {
    mockedAxios.mockResolvedValueOnce(response({ id: "local-order" }));
    updateOrderCache.mockImplementationOnce(async () => {
      if (!orderState.cached) return false;
      orderState.cached = {
        ...orderState.cached,
        status: "success",
        result: { id: "canonical-order" },
        ownerToken: "new-owner",
      };
      return false;
    });

    await expect(new BrokerExecutor().execute(node, {}, context)).resolves.toMatchObject({
      success: true,
      data: { id: "canonical-order" },
      meta: { cached: true },
    });
  });

  it("releases a newly-created claim when credentials are missing", async () => {
    getCredentials.mockResolvedValueOnce({ credentials: null });

    await expect(new BrokerExecutor().execute(node, {}, context)).resolves.toMatchObject({
      success: false,
      error: "Credentials not found for alpaca",
    });
    expect(releaseOrderClaim).toHaveBeenCalledTimes(1);
    expect(orderState.cached).toBeNull();
  });
});
