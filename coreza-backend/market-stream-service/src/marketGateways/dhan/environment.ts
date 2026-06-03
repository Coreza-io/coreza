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
    // TODO: confirm exact sandbox hosts from DhanHQ DevPortal before release.
    restBaseUrl: process.env.DHAN_SANDBOX_REST_URL || "https://sandbox.dhan.co/v2",
    marketWsUrl: process.env.DHAN_SANDBOX_MARKET_WS_URL || LIVE_MARKET_WS_URL,
    orderUpdateWsUrl:
      process.env.DHAN_SANDBOX_ORDER_WS_URL || LIVE_ORDER_UPDATE_WS_URL,
  },
};

export function resolveDhanEnvironment(creds: unknown): DhanEnvironment {
  if (!creds || typeof creds !== "object") return "live";
  const environment = String(
    (creds as { environment?: unknown }).environment ?? "",
  ).toLowerCase();
  return environment === "sandbox" ? "sandbox" : "live";
}

export function getDhanRestBaseUrl(env: DhanEnvironment): string {
  return DHAN_ENV_CONFIG[env].restBaseUrl;
}

export function getDhanMarketWsUrl(env: DhanEnvironment): string {
  return DHAN_ENV_CONFIG[env].marketWsUrl;
}

export function getDhanOrderUpdateWsUrl(env: DhanEnvironment): string {
  return DHAN_ENV_CONFIG[env].orderUpdateWsUrl;
}
