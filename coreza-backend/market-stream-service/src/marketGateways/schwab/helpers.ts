import type { CorezaMarketEvent } from "../../types/marketEvent";
import type { GatewayPreConnectContext } from "../types";
import {
  OAuthRefreshProviderConfig,
  refreshOAuthTokenIfNeeded,
} from "../../utils/oauthTokenManager";
import {
  buildSchwabLoginMessage,
  fetchSchwabStreamingConfig,
  parseSchwabStreamingMessage,
} from "../../utils/schwabStreamingSetup";

type SchwabAssetType = "equity" | "future";
type SchwabStreamType = "quote" | "chart" | "account_activity";
type SchwabService =
  | "LEVELONE_EQUITIES"
  | "LEVELONE_FUTURES"
  | "CHART_EQUITY"
  | "CHART_FUTURES"
  | "ACCT_ACTIVITY";

type SchwabRequestCredentials = {
  schwabClientCustomerId?: unknown;
  schwabClientCorrelId?: unknown;
};

const DEFAULT_ASSET_TYPE: SchwabAssetType = "equity";

const SCHWAB_SERVICE_MAP: Record<
  SchwabAssetType,
  Partial<Record<SchwabStreamType, SchwabService>>
> = {
  equity: {
    quote: "LEVELONE_EQUITIES",
    chart: "CHART_EQUITY",
  },
  future: {
    quote: "LEVELONE_FUTURES",
    chart: "CHART_FUTURES",
  },
};

const SCHWAB_SERVICE_REVERSE: Record<SchwabService, SchwabStreamType> = {
  LEVELONE_EQUITIES: "quote",
  LEVELONE_FUTURES: "quote",
  CHART_EQUITY: "chart",
  CHART_FUTURES: "chart",
  ACCT_ACTIVITY: "account_activity",
};

const SCHWAB_SERVICE_FIELDS: Record<SchwabService, string> = {
  LEVELONE_EQUITIES: "0,1,2,3,4,5,8,10,11,12,17,34,35",
  LEVELONE_FUTURES: "0,1,2,3,4,5,8,10,11,12,13,14,18",
  CHART_EQUITY: "0,1,2,3,4,5,6,7,8",
  CHART_FUTURES: "0,1,2,3,4,5,6,7,8",
  ACCT_ACTIVITY: "0,1,2,3",
};

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toSymbol(value: unknown): string {
  return typeof value === "string" ? value.toUpperCase() : "";
}

function parseSchwabAssetType(source?: string): SchwabAssetType {
  const rawAsset = String(source || "")
    .split("_")[1]
    ?.toLowerCase();
  return rawAsset === "future" ? "future" : DEFAULT_ASSET_TYPE;
}

function parseSchwabStreamName(streamName: string): {
  symbol: string;
  streamType: SchwabStreamType;
} {
  const [rawSymbol, rawStreamType = "quote"] = streamName.split("@");
  const normalizedStreamType = (
    rawStreamType === "account_activity"
      ? "account_activity"
      : rawStreamType.split("_")[0]
  ) as SchwabStreamType;

  if (
    normalizedStreamType !== "quote" &&
    normalizedStreamType !== "chart" &&
    normalizedStreamType !== "account_activity"
  ) {
    throw new Error(`Unsupported Schwab stream type: ${rawStreamType}`);
  }

  return {
    symbol: rawSymbol.toUpperCase(),
    streamType: normalizedStreamType,
  };
}

function resolveSchwabService(
  streamType: SchwabStreamType,
  assetType: SchwabAssetType,
): SchwabService {
  const service = SCHWAB_SERVICE_MAP[assetType][streamType];
  if (!service) {
    throw new Error(
      `Unsupported Schwab stream combination: ${assetType}/${streamType}`,
    );
  }
  return service;
}

function isAccountActivityRequest(
  streamNames: string[],
  source?: string,
): boolean {
  return (
    source === "schwab_trading" ||
    streamNames.some((streamName) => {
      const [, rawStreamType = streamName] = streamName.split("@");
      return (
        rawStreamType.split("_").slice(0, 2).join("_") === "account_activity"
      );
    })
  );
}

function buildSchwabRequest(
  streamNames: string[],
  command: "SUBS" | "UNSUBS",
  source?: string,
  creds?: SchwabRequestCredentials,
) {
  const assetType = parseSchwabAssetType(source);
  const symbolsByService = new Map<SchwabService, Set<string>>();
  const accountActivity = isAccountActivityRequest(streamNames, source);

  for (const streamName of streamNames) {
    const { symbol, streamType } = accountActivity
      ? {
          symbol: streamName.includes("@")
            ? streamName.split("@")[0].toUpperCase()
            : streamName.toUpperCase(),
          streamType: "account_activity" as SchwabStreamType,
        }
      : parseSchwabStreamName(streamName);
    const service =
      streamType === "account_activity"
        ? "ACCT_ACTIVITY"
        : resolveSchwabService(streamType, assetType);
    if (!symbolsByService.has(service)) {
      symbolsByService.set(service, new Set());
    }
    symbolsByService.get(service)!.add(symbol);
  }

  const requests = Array.from(symbolsByService.entries()).map(
    ([service, symbols], index) => {
      const keys = Array.from(symbols).join(",");
      console.log(
        `[Schwab Streaming] ${command} resolved ${assetType}/${SCHWAB_SERVICE_REVERSE[service]} to ${service}: ${keys}`,
      );

      return {
        requestid: String(Date.now() + index),
        service,
        command,
        SchwabClientCustomerId: creds?.schwabClientCustomerId,
        SchwabClientCorrelId: creds?.schwabClientCorrelId,
        parameters: {
          keys,
          ...(command === "SUBS"
            ? { fields: SCHWAB_SERVICE_FIELDS[service] }
            : {}),
        },
      };
    },
  );

  return { requests };
}

function flattenSchwabContentMessages(messages: any[]): any[] {
  const flattened: any[] = [];

  for (const message of messages) {
    if (Array.isArray(message?.content) && message.content.length > 1) {
      for (const content of message.content) {
        flattened.push({ ...message, content: [content] });
      }
      continue;
    }

    flattened.push(message);
  }

  return flattened;
}

export async function preConnectSchwab(
  creds: any,
  context: GatewayPreConnectContext,
  oauthRefreshConfig: OAuthRefreshProviderConfig,
) {
  const readyCreds = await refreshOAuthTokenIfNeeded(
    creds,
    context.userId,
    context.credentialId,
    oauthRefreshConfig,
  );

  if (!readyCreds.access_token) {
    throw new Error(
      "Schwab access token is missing after refresh readiness check",
    );
  }

  return fetchSchwabStreamingConfig(readyCreds.access_token);
}

export function buildSchwabAuthMessage(creds: any) {
  return buildSchwabLoginMessage(creds);
}

export function buildSchwabSubscribeMessage(
  streamNames: string[],
  source?: string,
  creds?: SchwabRequestCredentials,
) {
  return buildSchwabRequest(streamNames, "SUBS", source, creds);
}

export function buildSchwabUnsubscribeMessage(
  streamNames: string[],
  source?: string,
  creds?: SchwabRequestCredentials,
) {
  return buildSchwabRequest(streamNames, "UNSUBS", source, creds);
}

export function parseSchwabMessage(buffer: Buffer): any[] {
  const parsed = JSON.parse(buffer.toString());
  return flattenSchwabContentMessages(parseSchwabStreamingMessage(parsed));
}

type SchwabLoginResponse = {
  service: "ADMIN";
  command: "LOGIN";
  content?: unknown;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchwabLoginResponse(msg: unknown): msg is SchwabLoginResponse {
  return (
    isObjectRecord(msg) &&
    msg.service === "ADMIN" &&
    msg.command === "LOGIN"
  );
}

function getSchwabLoginCode(msg: SchwabLoginResponse): unknown {
  return isObjectRecord(msg.content) ? msg.content.code : undefined;
}

export function isSchwabAuthSuccess(msg: unknown): boolean {
  return isSchwabLoginResponse(msg) && Number(getSchwabLoginCode(msg)) === 0;
}

export function isSchwabAuthError(msg: unknown): boolean {
  if (!isSchwabLoginResponse(msg)) return false;

  const code = getSchwabLoginCode(msg);
  return code !== undefined && Number(code) !== 0;
}

export function identifySchwabMessageType(msg: any): string {
  return (
    SCHWAB_SERVICE_REVERSE[msg.service as SchwabService] ||
    msg.service ||
    "unknown"
  );
}

export function shouldPublishSchwabMessage(msg: any): boolean {
  return Boolean(
    SCHWAB_SERVICE_REVERSE[msg.service as SchwabService] &&
    msg.content?.length > 0,
  );
}

function parseJsonObject(value: unknown): Record<string, any> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  if (typeof value !== "string" || value.trim() === "") return undefined;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, any>)
      : undefined;
  } catch {
    return undefined;
  }
}

function toMessageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickTextField(
  messageText: string,
  fieldNames: string[],
): string | undefined {
  if (!messageText) return undefined;

  for (const fieldName of fieldNames) {
    const escaped = escapeRegExp(fieldName);
    const patterns = [
      new RegExp(`<${escaped}[^>]*>([^<]*)</${escaped}>`, "i"),
      new RegExp(`${escaped}=["']([^"']+)["']`, "i"),
      new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, "i"),
      new RegExp(`"${escaped}"\\s*:\\s*([^,}\\s]+)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = messageText.match(pattern);
      const value = match?.[1]?.trim();
      if (value) return value;
    }
  }

  return undefined;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function normalizeSchwabOrderStatus(status: unknown): string {
  const normalized = String(status || "")
    .toUpperCase()
    .replace(/[ -]/g, "_");

  if (
    ["PENDING_ACTIVATION", "PENDING_SUBMIT", "AWAITING_PARENT_ORDER"].includes(
      normalized,
    )
  ) {
    return "submitted";
  }
  if (
    ["QUEUED", "WORKING", "ACCEPTED", "PENDING_REPLACE"].includes(normalized)
  ) {
    return "working";
  }
  if (["PARTIAL_FILL", "PARTIALLY_FILLED"].includes(normalized)) {
    return "partially_filled";
  }
  if (["FILLED", "FILL"].includes(normalized)) return "filled";
  if (["CANCELED", "CANCELLED", "PENDING_CANCEL"].includes(normalized))
    return "cancelled";
  if (["REJECTED", "DENIED"].includes(normalized)) return "rejected";
  if (["EXPIRED"].includes(normalized)) return "expired";

  return "unknown";
}

function normalizeSchwabAccountActivityMessage(
  msg: any,
): CorezaMarketEvent | null {
  const content = msg.content?.[0];
  if (!content) return null;

  const rawMessageData =
    content["3"] ?? content.messageData ?? content.MessageData;
  const rawMessageText = toMessageText(rawMessageData);
  const messageData = parseJsonObject(rawMessageData) || {};
  const order =
    parseJsonObject(messageData.order) ||
    parseJsonObject(messageData.Order) ||
    messageData;
  const orderLeg = Array.isArray(order.orderLegCollection)
    ? order.orderLegCollection[0]
    : Array.isArray(order.OrderLegCollection)
      ? order.OrderLegCollection[0]
      : undefined;

  const orderId = pickString(
    order.orderId,
    order.order_id,
    order.OrderId,
    order.OrderID,
    messageData.orderId,
    messageData.OrderId,
    content.orderId,
    content.OrderId,
    pickTextField(rawMessageText, [
      "orderId",
      "OrderId",
      "OrderID",
      "OrderKey",
      "orderKey",
    ]),
  );
  const rawStatus = pickString(
    order.status,
    order.Status,
    messageData.status,
    messageData.Status,
    content.status,
    content.Status,
    pickTextField(rawMessageText, ["status", "Status", "OrderStatus"]),
  );
  const quantity =
    toNumber(order.quantity) ??
    toNumber(order.quantityRequested) ??
    toNumber(orderLeg?.quantity) ??
    toNumber(
      pickTextField(rawMessageText, [
        "quantity",
        "Quantity",
        "quantityRequested",
      ]),
    );
  const filledQty =
    toNumber(order.filledQuantity) ??
    toNumber(order.filledQty) ??
    toNumber(pickTextField(rawMessageText, ["filledQuantity", "filledQty"]));

  return {
    source: "schwab",
    symbol: toSymbol(
      pickString(
        order.symbol,
        order.Symbol,
        orderLeg?.instrument?.symbol,
        orderLeg?.Instrument?.Symbol,
        content.symbol,
        content.Symbol,
        pickTextField(rawMessageText, ["symbol", "Symbol"]),
      ),
    ),
    type: "order_update",
    orderEvent: pickString(
      content["2"],
      content.messageType,
      content.MessageType,
    ),
    orderId,
    clientOrderId: pickString(
      order.clientOrderId,
      order.client_order_id,
      pickTextField(rawMessageText, ["clientOrderId", "client_order_id"]),
    ),
    side: pickString(
      order.instruction,
      order.Instruction,
      orderLeg?.instruction,
      pickTextField(rawMessageText, [
        "instruction",
        "Instruction",
        "side",
        "Side",
      ]),
    ),
    orderStatus: normalizeSchwabOrderStatus(rawStatus),
    requestedQty: quantity,
    filledQty,
    filledAvgPrice:
      toNumber(order.averagePrice) ??
      toNumber(order.averageFillPrice) ??
      toNumber(
        pickTextField(rawMessageText, ["averagePrice", "averageFillPrice"]),
      ),
    accountId: pickString(
      content["1"],
      content.accountId,
      content.accountNumber,
      messageData.accountId,
      pickTextField(rawMessageText, ["accountId", "accountNumber", "Account"]),
    ),
    brokerAccountHash: pickString(
      content.key,
      content["0"],
      content.accountHash,
      messageData.accountHash,
      pickTextField(rawMessageText, ["accountHash", "brokerAccountHash"]),
    ),
    t: toNumber(order.enteredTime) ?? toNumber(order.closeTime) ?? Date.now(),
    rawOrderData: msg,
  };
}

function normalizeSchwabQuoteMessage(
  msg: any,
  service: SchwabService,
): CorezaMarketEvent | null {
  const content = msg.content?.[0];
  if (!content) return null;

  const isFuture = service === "LEVELONE_FUTURES";

  return {
    source: "schwab",
    symbol: toSymbol(content.key || content["0"]),
    type: "quote",
    t:
      toNumber(content[isFuture ? "11" : "35"]) ??
      toNumber(content[isFuture ? "10" : "34"]) ??
      Date.now(),
    p: toNumber(content["3"]),
    b: toNumber(content["1"]),
    B: toNumber(content["4"]),
    a: toNumber(content["2"]),
    A: toNumber(content["5"]),
    o: toNumber(content[isFuture ? "18" : "17"]),
    h: toNumber(content[isFuture ? "12" : "10"]),
    l: toNumber(content[isFuture ? "13" : "11"]),
    c: toNumber(content[isFuture ? "14" : "12"]),
    v: toNumber(content["8"]),
  };
}

function normalizeSchwabChartMessage(msg: any): CorezaMarketEvent | null {
  const content = msg.content?.[0];
  if (!content) return null;

  return {
    source: "schwab",
    symbol: toSymbol(content.key || content["0"]),
    type: "chart",
    t: toNumber(content["7"]) ?? Date.now(),
    o: toNumber(content["1"]),
    h: toNumber(content["2"]),
    l: toNumber(content["3"]),
    c: toNumber(content["4"]),
    v: toNumber(content["5"]),
  };
}

export function normalizeSchwabMessage(msg: any): CorezaMarketEvent | null {
  const service = msg.service as SchwabService;
  const streamType = SCHWAB_SERVICE_REVERSE[service];

  if (streamType === "quote") return normalizeSchwabQuoteMessage(msg, service);
  if (streamType === "chart") return normalizeSchwabChartMessage(msg);
  if (streamType === "account_activity")
    return normalizeSchwabAccountActivityMessage(msg);

  return null;
}
