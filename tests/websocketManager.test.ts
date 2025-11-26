import { IncomingMessage } from "http";
import { Socket } from "net";
import { createRemoteJWKSet, jwtVerify } from "jose";

jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
}));

describe("WebSocketManager verifyClient", () => {
  const mockJwks = jest.fn();
  const done = jest.fn();
  let manager: import("../coreza-backend/src/services/websocketManager").WebSocketManager;
  let verifyJWTMock: jest.SpyInstance;

  beforeAll(() => {
    process.env.SUPABASE_URL = "http://localhost:8000";
  });

  beforeEach(() => {
    jest.resetModules();
    (createRemoteJWKSet as jest.Mock).mockReturnValue(mockJwks);
    (jwtVerify as jest.Mock).mockClear();
    (jwtVerify as jest.Mock).mockResolvedValue({ payload: { sub: "user-123" } });

    const module = require("../coreza-backend/src/services/websocketManager");
    manager = module.WebSocketManager.getInstance();
    (manager as any).jwks = mockJwks;
    verifyJWTMock = jest
      .spyOn(manager as any, "verifyJWT")
      .mockResolvedValue({ userId: "user-123" });
    done.mockReset();
  });

  afterEach(() => {
    verifyJWTMock.mockRestore();
  });

  const buildRequest = (path: string) => {
    const req = new IncomingMessage(new Socket());
    req.url = path;
    (req as any).headers = { host: "localhost" };
    return req;
  };

  it("accepts valid tokens and attaches the user id", async () => {
    const info = { origin: "", secure: false, req: buildRequest("/?token=test-token") };

    await (manager as any).verifyClient(info, done);

    expect(verifyJWTMock).toHaveBeenCalledWith("test-token");
    expect((info.req as any).userId).toBe("user-123");
    expect(done).toHaveBeenCalledWith(true);
  });

  it("rejects missing tokens before reaching JWT verification", async () => {
    const info = { origin: "", secure: false, req: buildRequest("/") };

    await (manager as any).verifyClient(info, done);

    expect(verifyJWTMock).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(false, 401, "Unauthorized");
  });
});
