import type { BrokerPortfolioHooks, BrokerPortfolioSyncContext } from "../types";
import { createSuccessOutput, createErrorOutput } from "../../utils/nodeResultHelpers";
import type { NodeResult } from "../../nodes/types";
import { createLogger } from "../../utils/logger";
import { countLive, observeStage, timingNow } from "../../utils/liveTiming";

const fillLogger = createLogger("PortfolioExecutor:fills");

function normalizeSide(value: any): "buy" | "sell" {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (s === "buy") return "buy";
  if (s === "sell") return "sell";
  throw new Error(`side must be BUY or SELL, got: ${value}`);
}

function normalizeSymbol(value: any): string {
  const s = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!s) throw new Error("symbol is required");
  return s;
}

function toNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;

  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

type AlpacaAccountResponse = {
  cash?: string | number;
  currency?: string;
  buying_power?: string | number;
  equity?: string | number;
  portfolio_value?: string | number;
  multiplier?: string | number;
  initial_margin?: string | number;
};

type AlpacaPosition = {
  symbol?: string;
  qty?: string | number;
  avg_entry_price?: string | number;
  current_price?: string | number;
  side?: string;
  asset_class?: string;
};

type AlpacaOrder = {
  id?: string;
  client_order_id?: string;
  symbol: string;
  qty: string | number;
  side: string;
  type: string;
  status: string;
  timeInForce: string;
};

function normalizeAlpacaCryptoSymbol(symbol: any, assetClass?: string): string {
  const normalized = normalizeSymbol(symbol);
  if (String(assetClass || "").toLowerCase() !== "crypto") {
    return normalized;
  }

  if (normalized.includes("/")) {
    return normalized;
  }

  const match = normalized.match(/^([A-Z0-9]+)(USDT|USDC|USD|BTC)$/);
  if (!match) {
    return normalized;
  }

  return `${match[1]}/${match[2]}`;
}

export async function syncAlpacaPortfolioState({ pm, params, context, callBrokerOperation }: BrokerPortfolioSyncContext): Promise<NodeResult> {
  try {
    if (!params.credential_id) {
      return createErrorOutput(
          "credential_id is required when sync_from_broker is enabled",
        );
    }

    const brokerParams = {
      credential_id: params.credential_id,
      environment: params.environment || "paper",
    };

    const account = (await callBrokerOperation(
      "get_account",
      brokerParams,
      "alpaca",
      context,
    )) as AlpacaAccountResponse;

    const positionsResult = (await callBrokerOperation(
      "get_positions",
      brokerParams,
      "alpaca",
      context,
    )) as { positions?: AlpacaPosition[] };
    const positions = Array.isArray(positionsResult.positions)
      ? positionsResult.positions
      : [];

    const ordersResult = (await callBrokerOperation(
      "get_orders",
      {
        ...brokerParams,
        status: "open",
      },
      "alpaca",
      context,
    )) as { orders?: AlpacaOrder[] };
    const allOrders = Array.isArray(ordersResult.orders)
      ? ordersResult.orders
      : [];
    const openOrders = allOrders.filter((order) => {
      const status = String(order.status ?? "").toLowerCase();
      return ![
        "filled",
        "canceled",
        "cancelled",
        "expired",
        "rejected",
      ].includes(status);
    });

    const baseCurrency = String(account.currency || "USD").toUpperCase();
    const cash = toNumber(account.cash) ?? 0;
    const buyingPower = toNumber(account.buying_power) ?? cash;
    const margin = toNumber(account.multiplier) ?? 1;
    const equity = toNumber(account.equity) ?? 1;
    const initialMargin = toNumber(account.initial_margin);
    pm.initializePortfolio(baseCurrency, cash);

    pm.reconcileBalance({
      asset: baseCurrency,
      cash: cash,
      buyingPower: toNumber(account.buying_power) ?? cash,
      initialMargin: initialMargin,
      margin: margin,
      equity: equity,
      locked: Math.max(0, (toNumber(account.equity) ?? cash) - cash),
    });

    const syncedPositions: Array<{
      symbol: string;
      qty: number;
      avg_entry_price?: number;
      current_price?: number;
      side?: string;
    }> = [];

    for (const position of positions) {
      if (!position.symbol) continue;
      const symbol = normalizeAlpacaCryptoSymbol(
        position.symbol,
        position.asset_class,
      );
      const qty = Math.abs(toNumber(position.qty) ?? 0);
      if (qty <= 0) continue;
      const side =
        String(position.side ?? "").toLowerCase() === "short"
          ? "sell"
          : "buy";

      pm.applyPositionUpdate({
        symbol,
        positionQty: qty,
        avgFillPrice: toNumber(position.avg_entry_price) ?? 0,
        side,
        currentPrice: toNumber(position.current_price),
      });

      syncedPositions.push({
        symbol,
        qty,
        avg_entry_price: toNumber(position.avg_entry_price),
        current_price: toNumber(position.current_price),
        side: position.side,
      });
    }

    const syncedOrders: Array<{
      orderId: string;
      clientOrderId?: string;
      symbol: string;
      side: string;
      qty: number;
      status?: string;
    }> = [];

    for (const order of openOrders) {
      const orderId = order.id || order.client_order_id;
      const symbol = order.symbol;
      if (!orderId || !symbol || !order.side) continue;
      const normalizedSymbol = normalizeSymbol(symbol);
      const side = normalizeSide(order.side);
      const orderQty = Math.abs(toNumber(order.qty) ?? 0);

      pm.registerOrderIntent({
        orderId,
        clientOrderId: order.client_order_id,
        symbol: normalizedSymbol,
        side,
        origQty: orderQty,
        orderType: order.type ?? "",
        status: order.status ?? "unknown",
        timeInForce: order.timeInForce ?? "",
      });

      syncedOrders.push({
        orderId,
        clientOrderId: order.client_order_id,
        symbol: normalizedSymbol,
        side,
        qty: orderQty,
        status: order.status,
      });
    }

    return createSuccessOutput({
        environment: brokerParams.environment,
        cash,
        currency: baseCurrency,
        buyingPower,
        margin,
        initialMargin,
        equity,
        positions: syncedPositions,
        openOrders: syncedOrders,
      });
  } catch (error: any) {
    return createErrorOutput(error?.message || "Failed to sync broker state");
  }
}

export const alpacaPortfolioHooks: BrokerPortfolioHooks = {
  syncState: syncAlpacaPortfolioState,
  accountScope: (params) => JSON.stringify(["alpaca", params.environment === "live" ? "live" : "paper", params.credential_id ?? ""]),
  applyFill: (pm, input) => {
    const started = timingNow();
    const accepted = pm.applyOrderEvent(input);
    const outcome = accepted.reason ?? accepted.reconciliation?.reconciliationStatus ?? "accepted";
    countLive("alpaca_fill_reconciliation", outcome);
    observeStage("alpaca_fill_reconciliation", started, outcome);
    if (accepted.reconciliation) {
      fillLogger.info({ ...accepted.reconciliation, symbol: input.symbol, grossFillQty: accepted.quantity }, "Alpaca position reconciliation");
    }
    return accepted;
  },
};
