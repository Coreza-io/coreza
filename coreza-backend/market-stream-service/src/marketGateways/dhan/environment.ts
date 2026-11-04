export type DhanEnvironment = "sandbox" | "live";

interface DhanEnvironmentConfig {
  restBaseUrl: string;
  marketWsUrl: string;
  orderUpdateWsUrl: string;
}

const LIVE_REST_URL = "https://api.dhan.co/v2";
const LIVE_MARKET_WS_URL = "wss://api-feed.dhan.co";
const LIVE_ORDER_UPDATE_WS_URL = "wss://api-order-update.dhan.co";

const DHAN_ENV_CONFIG: Record<DhanEnvironment, DhanEnvironmentConfig> = {
  live: {
    restBaseUrl: process.env.DHAN_LIVE_REST_URL || LIVE_REST_URL,
    marketWsUrl: process.env.DHAN_LIVE_MARKET_WS_URL || LIVE_MARKET_WS_URL,
    orderUpdateWsUrl:
      process.env.DHAN_LIVE_ORDER_WS_URL || LIVE_ORDER_UPDATE_WS_URL,
  },
  sandbox: {
    restBaseUrl: process.env.DHAN_SANDBOX_REST_URL || "https://sandbox.dhan.co/v2",
    marketWsUrl: process.env.DHAN_SANDBOX_MARKET_WS_URL || "",
    orderUpdateWsUrl:
      process.env.DHAN_SANDBOX_ORDER_WS_URL || "",
  },
};

export function resolveDhanEnvironment(creds: unknown): DhanEnvironment {
  const environment = creds && typeof creds === "object" ? (creds as { environment?: unknown }).environment : undefined;
  if (environment !== "sandbox" && environment !== "live") {
    throw Object.assign(new Error("Choose an explicit Dhan environment: live or sandbox."), { code: "DHAN_ENVIRONMENT_REQUIRED" });
  }
  return environment;
}

export function getDhanRestBaseUrl(env: DhanEnvironment): string {
  return validateDhanEndpoint(DHAN_ENV_CONFIG[env].restBaseUrl, "https:");
}

export function getDhanMarketWsUrl(env: DhanEnvironment): string {
  const url = DHAN_ENV_CONFIG[env].marketWsUrl;
  if (!url) throw Object.assign(new Error("Dhan sandbox market feed is not configured. Set DHAN_SANDBOX_MARKET_WS_URL to a provider-confirmed sandbox endpoint."), { code: "DHAN_SANDBOX_MARKET_UNAVAILABLE" });
  return validateDhanEndpoint(url, "wss:");
}

export function getDhanOrderUpdateWsUrl(env: DhanEnvironment): string {
  const url = DHAN_ENV_CONFIG[env].orderUpdateWsUrl;
  if (!url) throw Object.assign(new Error("Dhan sandbox order-update feed is not configured. Set DHAN_SANDBOX_ORDER_WS_URL to a provider-confirmed sandbox endpoint."), { code: "DHAN_SANDBOX_ORDER_UNAVAILABLE" });
  return validateDhanEndpoint(url, "wss:");
}

function validateDhanEndpoint(value: string, protocol: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== protocol || url.username || url.password || url.search || url.hash) throw new Error();
    return value.replace(/\/$/, "");
  } catch { throw Object.assign(new Error("The configured Dhan endpoint is invalid."), { code: "DHAN_ENDPOINT_INVALID" }); }
}
