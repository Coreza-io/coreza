/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { SimBroker, Position } from "../../backtest/simBroker";
import { PortfolioManager } from "../../simulation/PortfolioManager";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  leanSuccess,
} from "../../utils/normalizeOutput";
import { Bar } from "../../backtest/simBroker/interfaces";
import { parseBar, parsePrices, toPercent } from "../../utils/barParser";
import {
  FormattedPosition,
  formatPositionWithPnlPercent,
} from "../../utils/portfolioHelpers";
import { isOurOrder } from "../../utils/orderIdempotency";
import { NodeExecutionContext } from "../../engine/types";

// Key prefix for SimBroker cache (shared with BacktestExecutor)
const SIM_BROKER_KEY_PREFIX = "simBroker:";

// ============== PARAMETER NORMALIZER HELPERS ==============

function parseRequiredString(value: any, field: string): string {
  const str = typeof value === "string" ? value.trim() : String(value ?? "");
  if (!str) throw new Error(`${field} is required`);
  return str;
}

function parseOptionalString(value: any): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).trim();
}

function parseOptionalNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = parseFloat(value);
  return isNaN(n) ? undefined : n;
}

function parseRequiredNumber(value: any, field: string): number {
  const n = parseFloat(value);
  if (isNaN(n)) throw new Error(`${field} must be a valid number`);
  return n;
}

function normalizeSide(value: any): "buy" | "sell" {
  const s = String(value ?? "").trim().toLowerCase();
  if (s === "buy") return "buy";
  if (s === "sell") return "sell";
  throw new Error(`side must be BUY or SELL, got: ${value}`);
}

function normalizeSymbol(value: any): string {
  const s = String(value ?? "").trim().toUpperCase();
  if (!s) throw new Error("symbol is required");
  return s;
}

/**
 * Unified PortfolioExecutor — handles both backtest (SimBroker) and live broker modes.
 *
 * Backtest mode: Delegates to the SimBroker instance cached by BacktestExecutor
 * Broker mode: Delegates to PortfolioManager for live broker data
 */
type BrokerPortfolioState = ReturnType<PortfolioManager["getPortfolioState"]>;

export class PortfolioExecutor implements INodeExecutor {
  readonly category = "Portfolio";
  // Backtest mode is fully sync. Broker mode is async, but compiled execution
  // only calls this node in backtest mode and the adapter safely rejects Promise returns.
  readonly syncCapable = true;

  // Local ownership cache: avoids Redis round-trip on every fill event (5-min TTL)
  private static ownershipCache = new Map<
    string,
    { ours: boolean; expiry: number }
  >();
  private static ownershipLookupCount = 0;

  private async checkOwnership(id: string): Promise<boolean> {
    // Periodic sweep every 1000 lookups to prevent unbounded memory growth
    if (++PortfolioExecutor.ownershipLookupCount % 1000 === 0) {
      const now = Date.now();
      for (const [key, val] of PortfolioExecutor.ownershipCache) {
        if (val.expiry < now) PortfolioExecutor.ownershipCache.delete(key);
      }
    }

    const cached = PortfolioExecutor.ownershipCache.get(id);
    if (cached && cached.expiry > Date.now()) return cached.ours;

    const result = await isOurOrder(id);
    PortfolioExecutor.ownershipCache.set(id, {
      ours: result.ours,
      expiry: Date.now() + 300_000, // 5 minutes
    });
    return result.ours;
  }

  /**
   * Parse a symbol param into an array. Supports comma-separated values.
   * e.g. "BTCUSDT" -> ["BTCUSDT"], "BTCUSDT,ETHUSDT" -> ["BTCUSDT","ETHUSDT"]
   */
  private parseSymbols(symbol?: string): string[] {
    if (!symbol) return [];
    return symbol
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  // Reference to the shared SimBroker cache from BacktestExecutor
  private static simBrokerCache = new Map<string, SimBroker>();

  /**
   * Allow BacktestExecutor to share its SimBroker cache reference.
   */
  static setSimBrokerCache(cache: Map<string, SimBroker>): void {
    PortfolioExecutor.simBrokerCache = cache;
  }

  execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: NodeExecutionContext,
  ): NodeResult | Promise<NodeResult> {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const mode = params.mode;

      if (mode === "backtest") {
        return this.executeBacktestMode(params, context);
      } else if (mode === "broker") {
        return this.executeBrokerMode(params, context);
      }

      return toNodeResult(createErrorOutput(`Unknown portfolio mode: ${mode}`));
    } catch (error) {
      console.error("[PortfolioExecutor] Execution failed:", error);
      return toNodeResult(createErrorOutput(error));
    }
  }

  // ============== BACKTEST MODE ==============

  private executeBacktestMode(
    params: any,
    context?: NodeExecutionContext,
  ): NodeResult {
    return this.executeBacktestModeSync(params, context);
  }

  private executeBacktestModeSync(
    params: any,
    _context?: NodeExecutionContext,
  ): NodeResult {
    const backtestId = params.backtest_id;
    if (!backtestId) {
      return toNodeResult(createErrorOutput("backtest_id is required"));
    }

    const key = `${SIM_BROKER_KEY_PREFIX}${backtestId}`;
    const simBroker = PortfolioExecutor.simBrokerCache.get(key);
    if (!simBroker) {
      return toNodeResult(
        createErrorOutput(
          `No SimBroker found for backtest ${backtestId}. Ensure BacktestInit ran first.`,
        ),
      );
    }

    const operation = params.operation || "get_portfolio";
    const symbol = params.symbol?.trim().toUpperCase();
    const currentBar = parseBar(params.current_bar);
    const prices = parsePrices(params.prices);

    // Mark-to-market before reading
    if (
      ["get_portfolio", "get_position", "update_mtm", "get_equity"].includes(
        operation,
      )
    ) {
      if (prices && Object.keys(prices).length > 0) {
        simBroker.updateAllPositionsMTM(prices);
      } else if (currentBar && symbol) {
        simBroker.onBar(symbol, currentBar);
      }
    }

    switch (operation) {
      case "get_portfolio":
        return this.backtestGetAll(simBroker);
      case "get_position":
        return this.backtestGetPosition(simBroker, symbol);
      case "update_mtm":
        return this.backtestUpdateMTM(simBroker, symbol, currentBar, prices);
      case "get_cash":
        return this.backtestGetCash(simBroker);
      case "get_equity":
        return this.backtestGetEquity(simBroker);
      case "get_trades":
        return this.backtestGetTrades(simBroker);
      default:
        return toNodeResult(
          createErrorOutput(`Unknown portfolio operation: ${operation}`),
        );
    }
  }

  // ============== BROKER MODE ==============

  private async executeBrokerMode(
    params: any,
    context?: NodeExecutionContext,
  ): Promise<NodeResult> {
    const userId = context?.userId;
    if (!userId) {
      return toNodeResult(
        createErrorOutput("User ID required for broker mode"),
      );
    }

    const runId = context.runId || context.workflowId;
    if (!runId) {
      return toNodeResult(
        createErrorOutput(
          "runId is required for broker mode — cannot use workflowId as fallback",
        ),
      );
    }

    // Get or create PortfolioManager
    const pm = PortfolioManager.getInstance(userId, runId);

    const symbols = this.parseSymbols(params.symbol);
    const operation = params.operation || "get_portfolio";
    const baseCurrency = params.base_currency || "USDT";

    if (operation === "create_portfolio") {
      if (pm.isBootstrapped()) {
        return toNodeResult(
          createSuccessOutput({
            message: "Portfolio already initialized",
            already_created: true,
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
      }

      const cashBalance = parseFloat(params.cash_balance);
      if (baseCurrency && !isNaN(cashBalance) && cashBalance >= 0) {
        pm.initializePortfolio(baseCurrency, cashBalance);
        return toNodeResult(
          createSuccessOutput({
            message: "Portfolio created with explicit cash balance",
            created: true,
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
      }

      return toNodeResult(
        createErrorOutput(
          "cash_balance must be a non-negative number for create_portfolio",
        ),
      );
    }

    switch (operation) {
      // ============== NEW v2 OPERATIONS ==============
      case "register_order_intent":
        return this.brokerRegisterOrderIntent(pm, params);
      case "apply_order_update":
        return this.brokerApplyOrderUpdate(pm, params);
      case "apply_execution":
        return this.brokerApplyExecution(pm, params, baseCurrency);
      case "sync_order_event":
        return this.brokerSyncOrderEvent(pm, params, baseCurrency);
      case "reconcile_position":
        return this.brokerReconcilePosition(pm, params);
      case "reconcile_balances":
        return this.brokerReconcileBalances(pm, params);

      // ============== EXISTING OPERATIONS ==============
      case "get_portfolio":
        return this.brokerGetAll(pm, baseCurrency);
      case "update_portfolio":
        // Legacy operation — route through new methods internally
        return this.brokerLegacyUpdatePortfolio(pm, params, baseCurrency);
      case "update_mtm": {
        // Accept market_price (new) or price (legacy) for MTM
        const mtmPrice = parseFloat(params.market_price ?? params.price);
        if (symbols.length === 0 || isNaN(mtmPrice) || mtmPrice <= 0) {
          return toNodeResult(
            createErrorOutput("Provide symbol and market_price for update_mtm"),
          );
        }

        const priceMap: Record<string, number> = {};
        for (const sym of symbols) {
          priceMap[sym] = mtmPrice;
        }

        pm.updateMarketPrices(priceMap, baseCurrency);
        return toNodeResult(
          createSuccessOutput({
            updated: true,
            prices_updated: priceMap,
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
      }
      case "get_position":
        return this.brokerGetPosition(pm, symbols);
      case "get_cash":
        return this.brokerGetCash(pm, baseCurrency);
      case "get_equity":
        return this.brokerGetEquity(pm, baseCurrency);
      case "get_trades":
        return this.brokerGetTrades(pm);
      case "register_order": {
        // Legacy operation — route through registerOrderIntent
        return this.brokerLegacyRegisterOrder(pm, params);
      }
      case "cancel_order": {
        const cancelOrderId = parseOptionalString(params.broker_order_id)
          ?? parseOptionalString(params.fill_id)
          ?? parseOptionalString(params.order_id);
        if (!cancelOrderId) {
          return toNodeResult(
            createErrorOutput(
              "broker_order_id (or fill_id) is required for cancel_order",
            ),
          );
        }

        const cancelResult = pm.cancelOrder(cancelOrderId);
        return toNodeResult(
          createSuccessOutput({
            removed: cancelResult.removed,
            cancelled_order: cancelResult.order || null,
            pending_orders_count: pm.getPendingOrders().length,
          }),
        );
      }
      case "get_pending_orders": {
        const pendingOrders = pm.getPendingOrders();
        const v2PendingOrders = pm.getV2PendingOrders();
        const filterSymbol = params.symbol?.trim().toUpperCase();
        const filtered = filterSymbol
          ? pendingOrders.filter((o) => o.order.symbol === filterSymbol)
          : pendingOrders;
        const v2Filtered = filterSymbol
          ? v2PendingOrders.filter((o) => o.symbol === filterSymbol)
          : v2PendingOrders;

        return toNodeResult(
          createSuccessOutput({
            pending_orders: filtered,
            pending_orders_count: filtered.length,
            total_pending_orders: pendingOrders.length,
            v2_pending_orders: v2Filtered,
            v2_pending_orders_count: v2Filtered.length,
          }),
        );
      }
      default:
        return toNodeResult(
          createErrorOutput(`Unknown portfolio operation: ${operation}`),
        );
    }
  }

  // ============== NEW v2 BROKER OPERATION HANDLERS ==============

  private brokerRegisterOrderIntent(
    pm: PortfolioManager,
    params: any,
  ): NodeResult {
    try {
      const brokerOrderId = parseRequiredString(
        params.broker_order_id,
        "broker_order_id",
      );
      const symbol = normalizeSymbol(params.symbol);
      const side = normalizeSide(params.side);
      const origQty = parseRequiredNumber(params.orig_qty, "orig_qty");

      const result = pm.registerOrderIntent({
        brokerOrderId,
        clientOrderId: parseOptionalString(params.client_order_id),
        symbol,
        side,
        origQty,
        orderType: parseOptionalString(params.order_type),
        timeInForce: parseOptionalString(params.time_in_force),
        limitPrice: parseOptionalNumber(params.limit_price),
        stopPrice: parseOptionalNumber(params.stop_price),
        trailPercent: parseOptionalNumber(params.trail_percent),
        trailPrice: parseOptionalNumber(params.trail_price),
        status: parseOptionalString(params.status),
      });

      return toNodeResult(
        createSuccessOutput({
          registered: result.registered,
          order: result.order,
          pending_orders_count: pm.getV2PendingOrders().length,
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  private async brokerApplyOrderUpdate(
    pm: PortfolioManager,
    params: any,
  ): Promise<NodeResult> {
    try {
      const brokerOrderId = parseRequiredString(
        params.broker_order_id,
        "broker_order_id",
      );
      const symbol = normalizeSymbol(params.symbol);
      const status = parseRequiredString(params.status, "status");

      // Ownership check
      const clientOrderId = parseOptionalString(params.client_order_id);
      const { ours } = await this.brokerEnsureOwnedOrder(
        brokerOrderId,
        clientOrderId,
      );
      if (!ours) {
        console.log(
          `[PortfolioExecutor] Skipping order update for unknown order: ${brokerOrderId}`,
        );
        return toNodeResult(
          createSuccessOutput({
            updated: false,
            skipped: true,
            reason: "unknown_order",
            broker_order_id: brokerOrderId,
            message: "Order not placed by this system — update skipped",
          }),
        );
      }

      const result = pm.applyOrderUpdate({
        brokerOrderId,
        clientOrderId,
        symbol,
        status: status.toLowerCase(),
        origQty: parseOptionalNumber(params.orig_qty),
        cumFilledQty: parseOptionalNumber(params.cum_filled_qty),
        remainingQty: parseOptionalNumber(params.remaining_qty),
        avgFillPrice: parseOptionalNumber(params.avg_fill_price),
      });

      return toNodeResult(
        createSuccessOutput({
          updated: result.updated,
          order: result.order,
          pending_orders_count: pm.getV2PendingOrders().length,
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  private async brokerApplyExecution(
    pm: PortfolioManager,
    params: any,
    baseCurrency: string,
  ): Promise<NodeResult> {
    try {
      const symbol = normalizeSymbol(params.symbol);
      const side = normalizeSide(params.side);
      const execQty = parseRequiredNumber(params.exec_qty, "exec_qty");
      const execPrice = parseRequiredNumber(params.exec_price, "exec_price");

      const brokerOrderId = parseOptionalString(params.broker_order_id);
      const clientOrderId = parseOptionalString(params.client_order_id);

      // Ownership check
      const { ours } = await this.brokerEnsureOwnedOrder(
        brokerOrderId,
        clientOrderId,
      );
      if (!ours) {
        console.log(
          `[PortfolioExecutor] Skipping execution for unknown order: brokerOrderId=${brokerOrderId}, clientOrderId=${clientOrderId}`,
        );
        return toNodeResult(
          createSuccessOutput({
            applied: false,
            skipped: true,
            reason: "unknown_order",
            broker_order_id: brokerOrderId,
            client_order_id: clientOrderId,
            message:
              "Order was not placed by this system — execution skipped",
          }),
        );
      }

      const result = pm.applyExecution({
        brokerOrderId,
        executionId: parseOptionalString(params.execution_id),
        clientOrderId,
        symbol,
        side,
        execQty,
        execPrice,
        quoteNotional: parseOptionalNumber(params.quote_notional),
        feeAmount: parseOptionalNumber(params.fee_amount),
        feeAsset: parseOptionalString(params.fee_asset),
        cumFilledQty: parseOptionalNumber(params.cum_filled_qty),
        baseCurrency,
        applyPositionDelta: params.apply_position_delta !== false && params.apply_position_delta !== "false",
      });

      return toNodeResult(
        createSuccessOutput({
          applied: result.applied,
          reason: result.reason,
          execution_id: result.executionId,
          ...this.getPortfolioSummary(pm, baseCurrency),
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  private async brokerEnsureOwnedOrder(
    brokerOrderId?: string,
    clientOrderId?: string,
  ): Promise<{ ours: boolean }> {
    if (!brokerOrderId && !clientOrderId) {
      return { ours: true };
    }

    const isOurs =
      (brokerOrderId && (await this.checkOwnership(brokerOrderId))) ||
      (clientOrderId && (await this.checkOwnership(clientOrderId)));

    return { ours: !!isOurs };
  }

  private parseSyncOrderEventParams(params: any) {
    return {
      symbol: normalizeSymbol(params.symbol),
      brokerOrderId: parseOptionalString(params.broker_order_id),
      clientOrderId: parseOptionalString(params.client_order_id),
      status: parseOptionalString(params.status)?.toLowerCase(),
      side: parseOptionalString(params.side),
      executionId: parseOptionalString(params.execution_id),
      origQty: parseOptionalNumber(params.orig_qty),
      cumFilledQty: parseOptionalNumber(params.cum_filled_qty),
      remainingQty: parseOptionalNumber(params.remaining_qty),
      avgFillPrice: parseOptionalNumber(params.avg_fill_price),
      execQty: parseOptionalNumber(params.exec_qty),
      execPrice: parseOptionalNumber(params.exec_price),
      quoteNotional: parseOptionalNumber(params.quote_notional),
      feeAmount: parseOptionalNumber(params.fee_amount),
      feeAsset: parseOptionalString(params.fee_asset),
      positionQty: parseOptionalNumber(params.position_qty),
      avgEntryPrice: parseOptionalNumber(params.avg_entry_price),
      realizedPnl: parseOptionalNumber(params.realized_pnl),
      marketPrice: parseOptionalNumber(params.market_price ?? params.price),
      applyPositionDelta:
        params.apply_position_delta !== false &&
        params.apply_position_delta !== "false",
    };
  }

  private async brokerSyncOrderEvent(
    pm: PortfolioManager,
    params: any,
    baseCurrency: string,
  ): Promise<NodeResult> {
    try {
      const parsed = this.parseSyncOrderEventParams(params);
      const {
        symbol,
        brokerOrderId,
        clientOrderId,
        status,
        side,
        executionId,
        origQty,
        cumFilledQty,
        remainingQty,
        avgFillPrice,
        execQty,
        execPrice,
        quoteNotional,
        feeAmount,
        feeAsset,
        positionQty,
        avgEntryPrice,
        realizedPnl,
        marketPrice,
        applyPositionDelta,
      } = parsed;

      const { ours } = await this.brokerEnsureOwnedOrder(
        brokerOrderId,
        clientOrderId,
      );
      if (!ours) {
        return toNodeResult(
          createSuccessOutput({
            skipped: true,
            reason: "unknown_order",
            broker_order_id: brokerOrderId,
            client_order_id: clientOrderId,
          }),
        );
      }

      let order: any | undefined;
      let executionApplied = false;
      let executionResult: { reason?: string; executionId?: string } = {};
      let position: any | undefined;
      let orderUpdated = false;
      let positionReconciled = false;

      if (status) {
        const resolvedBrokerOrderId =
          brokerOrderId
          ?? pm.resolveOrderIdByClientId(clientOrderId ?? "");

        if (!resolvedBrokerOrderId) {
          console.warn(
            `[PortfolioExecutor] sync_order_event: order update skipped due to missing broker_order_id and unresolved client_order_id=${clientOrderId}`,
          );
        } else {
          const orderResult = pm.applyOrderUpdate({
            brokerOrderId: resolvedBrokerOrderId,
            clientOrderId,
            symbol,
            status,
            origQty,
            cumFilledQty,
            remainingQty,
            avgFillPrice,
          });
          orderUpdated = orderResult.updated;
          order = orderResult.order;
        }
      }

      if (execQty !== undefined && execPrice !== undefined && side) {
        const execResult = pm.applyExecution({
          brokerOrderId,
          executionId,
          clientOrderId,
          symbol,
          side: normalizeSide(side),
          execQty,
          execPrice,
          quoteNotional,
          feeAmount,
          feeAsset,
          cumFilledQty,
          baseCurrency,
          applyPositionDelta,
        });
        executionApplied = execResult.applied;
        executionResult = {
          reason: execResult.reason,
          executionId: execResult.executionId,
        };
      }

      if (positionQty !== undefined) {
        const positionResult = pm.reconcilePosition({
          symbol,
          positionQty,
          avgEntryPrice,
          realizedPnl,
          currentPrice: marketPrice,
        });
        positionReconciled = positionResult.reconciled;
        position = positionResult.position;
      }

      return toNodeResult(
        createSuccessOutput({
          order_updated: orderUpdated,
          execution_applied: executionApplied,
          position_reconciled: positionReconciled,
          skipped: false,
          order,
          execution_id: executionResult.executionId ?? executionId,
          execution_reason: executionResult.reason,
          position,
          ...this.getPortfolioSummary(pm, baseCurrency),
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  private brokerReconcilePosition(
    pm: PortfolioManager,
    params: any,
  ): NodeResult {
    try {
      const symbol = normalizeSymbol(params.symbol);
      const positionQty = parseRequiredNumber(
        params.position_qty,
        "position_qty",
      );

      const result = pm.reconcilePosition({
        symbol,
        positionQty,
        avgEntryPrice: parseOptionalNumber(params.avg_entry_price),
        realizedPnl: parseOptionalNumber(params.realized_pnl),
        currentPrice: parseOptionalNumber(params.market_price ?? params.price),
      });

      return toNodeResult(
        createSuccessOutput({
          reconciled: result.reconciled,
          position: result.position,
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  private brokerReconcileBalances(
    pm: PortfolioManager,
    params: any,
  ): NodeResult {
    try {
      const asset = parseRequiredString(params.asset, "asset");
      const total = parseRequiredNumber(params.total, "total");

      const result = pm.reconcileBalance({
        asset,
        total,
        available: parseOptionalNumber(params.available),
        locked: parseOptionalNumber(params.locked),
      });

      return toNodeResult(
        createSuccessOutput({
          reconciled: result.reconciled,
          balance: result.balance,
        }),
      );
    } catch (error: any) {
      return toNodeResult(createErrorOutput(error.message));
    }
  }

  // ============== LEGACY COMPATIBILITY WRAPPERS ==============

  /**
   * Legacy register_order → routes to registerOrderIntent with field aliasing.
   */
  private brokerLegacyRegisterOrder(
    pm: PortfolioManager,
    params: any,
  ): NodeResult {
    console.log(
      "[PortfolioExecutor] legacy_operation_used: register_order → register_order_intent",
    );

    const orderId = params.fill_id?.trim() || params.order_id?.trim();
    const clientOrderId = params.client_order_id?.trim() || undefined;
    const orderSymbol = params.symbol?.trim().toUpperCase();
    const orderSide = params.side?.trim().toUpperCase();
    const orderType = params.orderType;
    const orderQty = parseFloat(params.quantity);
    const limitPrice =
      parseFloat(params.limitPrice ?? params.limit_price ?? params.price) ||
      undefined;
    const stopPrice =
      parseFloat(params.stopPrice ?? params.stop_price) || undefined;
    const tif =
      params.tif?.trim() || params.timeInForce?.trim() || undefined;
    const trailPercent =
      parseFloat(params.trail_percent ?? params.trailPercent) || undefined;
    const trailPrice =
      parseFloat(params.trail_price ?? params.trailPrice) || undefined;
    const orderStatus = params.status;

    if (!orderId) {
      return toNodeResult(
        createErrorOutput(
          "order_id (or fill_id) is required for register_order",
        ),
      );
    }
    if (!orderSymbol) {
      return toNodeResult(
        createErrorOutput("symbol is required for register_order"),
      );
    }
    if (!orderSide || (orderSide !== "BUY" && orderSide !== "SELL")) {
      return toNodeResult(createErrorOutput("side must be BUY or SELL"));
    }
    if (isNaN(orderQty) || orderQty <= 0) {
      return toNodeResult(
        createErrorOutput("quantity must be a positive number"),
      );
    }

    const result = pm.registerOrder({
      orderId,
      clientOrderId,
      symbol: orderSymbol,
      side: orderSide.toLowerCase() as "buy" | "sell",
      quantity: orderQty,
      orderType: orderType,
      limitPrice,
      stopPrice,
      timeInForce: tif,
      trailPercent,
      trailPrice,
      status: orderStatus,
    });

    return toNodeResult(
      createSuccessOutput({
        registered: result.registered,
        pending_order: result.pending_order,
        pending_orders_count: pm.getPendingOrders().length,
        legacy_operation_used: true,
      }),
    );
  }

  /**
   * Legacy update_portfolio → routes through applyFill (unchanged behavior).
   */
  private async brokerLegacyUpdatePortfolio(
    pm: PortfolioManager,
    params: any,
    baseCurrency: string,
  ): Promise<NodeResult> {
    console.log(
      "[PortfolioExecutor] legacy_operation_used: update_portfolio",
    );

    const fillSymbol = params.symbol?.trim().toUpperCase();
    const side = params.side?.trim().toUpperCase();
    const rawQuantity = parseFloat(params.quantity);
    const price = parseFloat(params.price);
    let commission = parseFloat(params.commission || "0");
    if (isNaN(commission)) commission = 0;
    const fillId = params.fill_id?.trim() || undefined;
    const clientOrderId = params.client_order_id?.trim() || undefined;
    const orderStatus = params.status;

    if (!fillSymbol) {
      return toNodeResult(
        createErrorOutput("symbol is required for update_portfolio"),
      );
    }
    if (!side || (side !== "BUY" && side !== "SELL")) {
      return toNodeResult(createErrorOutput("side must be BUY or SELL"));
    }
    if (isNaN(rawQuantity) || rawQuantity === 0) {
      return toNodeResult(
        createErrorOutput("quantity must be a non-zero number"),
      );
    }
    if (isNaN(price) || price <= 0) {
      return toNodeResult(
        createErrorOutput("price must be a positive number"),
      );
    }

    // Order ownership verification
    if (fillId || clientOrderId) {
      const isOurs =
        (fillId && (await this.checkOwnership(fillId))) ||
        (clientOrderId && (await this.checkOwnership(clientOrderId)));
      if (!isOurs) {
        console.log(
          `[PortfolioExecutor] Skipping fill for unknown order: fillId=${fillId}, clientOrderId=${clientOrderId}`,
        );
        return toNodeResult(
          createSuccessOutput({
            updated: false,
            skipped: true,
            reason: "unknown_order",
            fill_id: fillId,
            client_order_id: clientOrderId,
            message: "Order was not placed by this system — fill skipped",
            legacy_operation_used: true,
            ...this.getPortfolioSummary(pm, baseCurrency),
          }),
        );
      }
    }

    const normalizedQuantity = Math.abs(rawQuantity);
    const quantity =
      side === "SELL" ? -normalizedQuantity : normalizedQuantity;

    const fillResult = pm.applyFill(
      { symbol: fillSymbol, quantity, price, orderStatus, commission },
      baseCurrency,
      fillId,
    );

    if (!fillResult.applied) {
      return toNodeResult(
        createSuccessOutput({
          updated: false,
          skipped: true,
          reason: fillResult.reason,
          fill_id: fillId,
          message: `Fill skipped: ${fillResult.reason}`,
          legacy_operation_used: true,
          ...this.getPortfolioSummary(pm, baseCurrency),
        }),
      );
    }

    return toNodeResult(
      createSuccessOutput({
        updated: true,
        fill_applied: {
          symbol: fillSymbol,
          side,
          quantity: normalizedQuantity,
          signedQuantity: quantity,
          price,
          commission,
          fill_id: fillId,
          client_order_id: clientOrderId,
          delta_qty: fillResult.deltaQty,
        },
        legacy_operation_used: true,
        ...this.getPortfolioSummary(pm, baseCurrency),
      }),
    );
  }

  // ============== BACKTEST HELPERS ==============

  private backtestGetAll(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positions = Object.values(state.positions);
    const formattedPositions: FormattedPosition[] = [];
    let positionsValue = 0;
    let unrealizedPnlValue = 0;
    let realizedPnlValue = 0;

    for (const position of positions) {
      formattedPositions.push(formatPositionWithPnlPercent(position));
      positionsValue += position.marketValue;
      unrealizedPnlValue += position.unrealizedPnl;
      realizedPnlValue += position.realizedPnl;
    }

    const initialCapital = simBroker.getConfig().initialCapital;
    const pendingOrders = simBroker.getPendingOrders();

    return leanSuccess({
      cash: state.cash,
      initial_capital: initialCapital,
      positions: formattedPositions,
      positions_count: positions.length,
      positions_value: positionsValue,
      unrealized_pnl_pct: toPercent(unrealizedPnlValue, initialCapital),
      unrealized_pnl: unrealizedPnlValue,
      realized_pnl_pct: toPercent(realizedPnlValue, initialCapital),
      realized_pnl: realizedPnlValue,
      total_equity: state.cash + positionsValue,
      pending_orders: pendingOrders,
      pending_orders_count: pendingOrders.length,
      trades: state.trades,
      trades_count: state.trades.length,
    });
  }

  private backtestGetPosition(
    simBroker: SimBroker,
    symbol?: string,
  ): NodeResult {
    if (!symbol) {
      return toNodeResult(
        createErrorOutput("'symbol' is required for get_position"),
      );
    }
    const position = simBroker.getPosition(symbol);
    const formattedPosition = position
      ? formatPositionWithPnlPercent(position)
      : null;
    const positionCostBasis = position
      ? Math.abs(position.avgEntryPrice * position.quantity)
      : 0;

    return leanSuccess({
      has_position: !!position,
      position: formattedPosition,
      symbol,
      quantity: position?.quantity || 0,
      side: position?.side || null,
      avg_entry_price: position?.avgEntryPrice || 0,
      current_price: position?.currentPrice || 0,
      unrealized_pnl_pct: toPercent(
        position?.unrealizedPnl || 0,
        positionCostBasis,
      ),
      unrealized_pnl: position?.unrealizedPnl || 0,
      realized_pnl_pct: toPercent(
        position?.realizedPnl || 0,
        positionCostBasis,
      ),
      realized_pnl: position?.realizedPnl || 0,
      market_value: position?.marketValue || 0,
    });
  }

  private backtestUpdateMTM(
    simBroker: SimBroker,
    symbol?: string,
    bar?: Bar | null,
    prices?: Record<string, number> | null,
  ): NodeResult {
    if (!(prices && Object.keys(prices).length > 0) && !(symbol && bar)) {
      return toNodeResult(
        createErrorOutput(
          "Provide either 'prices' map or both 'symbol' and 'current_bar' for update_mtm",
        ),
      );
    }
    return this.backtestGetAll(simBroker);
  }

  private backtestGetCash(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    return toNodeResult(
      createSuccessOutput({
        cash: state.cash,
        buying_power: state.cash,
        initial_capital: simBroker.getConfig().initialCapital,
      }),
    );
  }

  private backtestGetEquity(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positionsValue = Object.values(state.positions).reduce(
      (sum, p) => sum + p.marketValue,
      0,
    );
    const totalEquity = state.cash + positionsValue;
    const peak = state.peakEquity;
    const drawdownPct = peak > 0 ? ((peak - totalEquity) / peak) * 100 : 0;

    return leanSuccess({
      total_equity: totalEquity,
      cash: state.cash,
      positions_value: positionsValue,
      initial_capital: simBroker.getConfig().initialCapital,
      return_pct:
        ((totalEquity - simBroker.getConfig().initialCapital) /
          simBroker.getConfig().initialCapital) *
        100,
      peak_equity: peak,
      drawdown_pct: drawdownPct,
    });
  }

  private backtestGetTrades(simBroker: SimBroker): NodeResult {
    const trades = simBroker.getTrades();
    let totalRealizedPnl = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    for (const trade of trades) {
      totalRealizedPnl += trade.netPnl;
      if (trade.netPnl > 0) winningTrades += 1;
      else if (trade.netPnl < 0) losingTrades += 1;
    }

    return leanSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: totalRealizedPnl,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
    });
  }

  // ============== BROKER HELPERS ==============

  private brokerGetAll(pm: PortfolioManager, baseCurrency: string): NodeResult {
    const state = pm.getPortfolioState(baseCurrency);
    return leanSuccess({
      ...this.getPortfolioSummaryFromState(state),
      drawdown_pct:
        state.peakEquity > 0
          ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
          : 0,
      trades: state.trades,
    });
  }

  private getPortfolioSummary(
    pm: PortfolioManager,
    baseCurrency: string,
  ): Record<string, any> {
    return this.getPortfolioSummaryFromState(
      pm.getPortfolioState(baseCurrency),
    );
  }

  private getPortfolioSummaryFromState(
    state: BrokerPortfolioState,
  ): Record<string, any> {
    const formattedPositions: FormattedPosition[] = [];
    let positionsValue = 0;
    let unrealizedPnl = 0;
    let realizedPnl = 0;

    for (const position of state.positions) {
      formattedPositions.push(formatPositionWithPnlPercent(position));
      positionsValue += position.marketValue;
      unrealizedPnl += position.unrealizedPnl;
      realizedPnl += position.realizedPnl;
    }

    return {
      cash: state.cash,
      positions: formattedPositions,
      positions_count: state.positions.length,
      positions_value: positionsValue,
      unrealized_pnl: unrealizedPnl,
      realized_pnl: realizedPnl,
      total_equity: state.totalEquity,
      peak_equity: state.peakEquity,
      trades_count: state.trades.length,
      pending_orders: state.pendingOrders,
      pending_orders_count: state.pendingOrders.length,
    };
  }

  private brokerGetPosition(
    pm: PortfolioManager,
    symbols: string[],
  ): NodeResult {
    if (symbols.length === 0) {
      // No symbol provided: return all tracked positions
      const positions = pm.getPositions();
      return leanSuccess({
        positions: positions.map((p) => formatPositionWithPnlPercent(p)),
        positions_count: positions.length,
      });
    }

    if (symbols.length === 1) {
      // Single symbol: keep backward-compatible flat output
      const symbol = symbols[0];
      const position = pm.getPosition(symbol);
      const costBasis = position
        ? Math.abs(position.avgEntryPrice * position.quantity)
        : 0;

      return leanSuccess({
        has_position: !!position,
        position: position ? formatPositionWithPnlPercent(position) : null,
        symbol,
        quantity: position?.quantity || 0,
        side: position?.side || null,
        avg_entry_price: position?.avgEntryPrice || 0,
        current_price: position?.currentPrice || 0,
        unrealized_pnl_pct: toPercent(position?.unrealizedPnl || 0, costBasis),
        unrealized_pnl: position?.unrealizedPnl || 0,
        realized_pnl_pct: toPercent(position?.realizedPnl || 0, costBasis),
        realized_pnl: position?.realizedPnl || 0,
        market_value: position?.marketValue || 0,
      });
    }

    // Multiple symbols: return array of positions
    const results = symbols.map((symbol) => {
      const position = pm.getPosition(symbol);
      const costBasis = position
        ? Math.abs(position.avgEntryPrice * position.quantity)
        : 0;
      return {
        has_position: !!position,
        position: position ? formatPositionWithPnlPercent(position) : null,
        symbol,
        quantity: position?.quantity || 0,
        side: position?.side || null,
        avg_entry_price: position?.avgEntryPrice || 0,
        current_price: position?.currentPrice || 0,
        unrealized_pnl_pct: toPercent(position?.unrealizedPnl || 0, costBasis),
        unrealized_pnl: position?.unrealizedPnl || 0,
        realized_pnl_pct: toPercent(position?.realizedPnl || 0, costBasis),
        realized_pnl: position?.realizedPnl || 0,
        market_value: position?.marketValue || 0,
      };
    });

    return leanSuccess({
      positions: results,
      positions_count: results.length,
    });
  }

  private brokerGetCash(
    pm: PortfolioManager,
    baseCurrency: string,
  ): NodeResult {
    const cash = pm.getCash();
    return leanSuccess({
      cash,
      buying_power: cash[baseCurrency] || 0,
    });
  }

  private brokerGetEquity(
    pm: PortfolioManager,
    baseCurrency: string,
  ): NodeResult {
    const state = pm.getPortfolioState(baseCurrency);
    const positionsValue = state.positions.reduce(
      (s, p) => s + p.marketValue,
      0,
    );
    return leanSuccess({
      total_equity: state.totalEquity,
      cash_base: pm.getCash()[baseCurrency] || 0,
      positions_value: positionsValue,
      peak_equity: state.peakEquity,
      drawdown_pct:
        state.peakEquity > 0
          ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
          : 0,
    });
  }

  private brokerGetTrades(pm: PortfolioManager): NodeResult {
    const trades = pm.getTrades();
    let totalRealizedPnl = 0;
    let winningTrades = 0;
    let losingTrades = 0;

    for (const trade of trades) {
      totalRealizedPnl += trade.netPnl;
      if (trade.netPnl > 0) winningTrades += 1;
      else if (trade.netPnl < 0) losingTrades += 1;
    }

    return leanSuccess({
      trades,
      count: trades.length,
      total_realized_pnl: totalRealizedPnl,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
    });
  }
}
