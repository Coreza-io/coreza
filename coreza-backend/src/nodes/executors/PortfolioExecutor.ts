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
import { SimBroker, Position } from "../../services/simBroker";
import { PortfolioManager } from "../../services/PortfolioManager";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";
import CredentialManager from "../../utils/credentialManager";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";
import { getBrokerConfig } from "../../brokers";
import { Bar } from "../../services/simBroker/interfaces";
import { parseBar, parsePrices, toPercent } from "../../utils/barParser";
import { formatPositionWithPnlPercent } from "../../utils/portfolioHelpers";
import axios from "axios";
import { signHmacSha256 } from "../../utils/crypto";
import { getBinanceTimestamp } from "../../utils/binanceTimeSync";

// Key prefix for SimBroker cache (shared with BacktestExecutor)
const SIM_BROKER_KEY_PREFIX = "simBroker:";

/**
 * Unified PortfolioExecutor — handles both backtest (SimBroker) and live broker modes.
 *
 * Backtest mode: Delegates to the SimBroker instance cached by BacktestExecutor
 * Broker mode: Delegates to PortfolioManager for live Binance Spot data
 */
export class PortfolioExecutor implements INodeExecutor {
  readonly category = "Portfolio";

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

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
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

  private async executeBacktestMode(
    params: any,
    _context: any,
  ): Promise<NodeResult> {
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
    const symbol = params.symbol;
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
      case "get_pending_orders":
        return this.backtestGetPendingOrders(simBroker);
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
    context: any,
  ): Promise<NodeResult> {
    const broker = params.broker.toLowerCase();
    const credentialId = params.credential_id;
    const userId = context?.userId;

    if (!credentialId) {
      return toNodeResult(
        createErrorOutput("credential_id is required for broker mode"),
      );
    }
    if (!userId) {
      return toNodeResult(
        createErrorOutput("User ID required for broker mode"),
      );
    }

    // Get broker config and credentials
    const config = getBrokerConfig(broker);
    if (!config) {
      return toNodeResult(createErrorOutput(`Unsupported broker: ${broker}`));
    }

    const { credentials } = await CredentialManager.getCredentials(
      userId,
      broker,
      credentialId,
    );
    if (!credentials) {
      return toNodeResult(
        createErrorOutput(`Credentials not found for ${broker}`),
      );
    }

    let creds = credentials.client_json;
    if (config.authType === "oauth") {
      creds = await refreshOAuthTokenIfNeeded(
        broker,
        creds,
        userId,
        credentialId,
      );
    }

    const environment = params.environment as "live" | "testnet";
    const baseUrl =
      typeof config.baseUrl === "function"
        ? config.baseUrl(creds, params)
        : config.baseUrl;
    const headers = await config.makeAuthHeaders(creds);

    // Get or create PortfolioManager
    const pm = PortfolioManager.getInstance(userId, broker, credentialId);

    // Bootstrap if first access
    if (!pm.isBootstrapped()) {
      const extraSymbols = this.parseSymbols(params.symbol);
      await pm.bootstrap(baseUrl, headers, creds, extraSymbols, environment);
    }

    // Ensure all requested symbols are tracked (lazy symbol tracking)
    const symbols = this.parseSymbols(params.symbol);
    for (const sym of symbols) {
      await pm.ensureSymbolTracked(baseUrl, headers, creds, sym, environment);
    }

    const operation = params.operation;

    switch (operation) {
      case "get_portfolio":
        return this.brokerGetAll(pm);
      case "get_position":
        return this.brokerGetPosition(pm, symbols);
      case "get_cash":
        return this.brokerGetCash(pm);
      case "get_equity":
        return this.brokerGetEquity(pm);
      case "get_trades":
        return this.brokerGetTrades(pm);
      case "get_pending_orders":
        return this.brokerGetPendingOrders(
          baseUrl,
          headers,
          creds,
          symbols,
          environment,
        );
      case "sync_trades": {
        const syncSymbols =
          symbols.length > 0 ? symbols : pm.getTrackedSymbols();
        let totalCount = 0;
        for (const sym of syncSymbols) {
          totalCount += await pm.syncSymbolTrades(
            baseUrl,
            headers,
            creds,
            sym,
            environment,
          );
        }
        return toNodeResult(
          createSuccessOutput({
            synced_trades: totalCount,
            symbols: syncSymbols,
            message: `Synced ${totalCount} new trades for ${syncSymbols.length} symbol(s)`,
          }),
        );
      }
      default:
        return toNodeResult(
          createErrorOutput(`Unknown portfolio operation: ${operation}`),
        );
    }
  }

  // ============== BACKTEST HELPERS ==============

  private backtestGetAll(simBroker: SimBroker): NodeResult {
    const state = simBroker.getPortfolioState();
    const positions = Object.values(state.positions);
    const formattedPositions = positions.map((p) =>
      formatPositionWithPnlPercent(p),
    );
    const positionsValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const initialCapital = simBroker.getConfig().initialCapital;
    const unrealizedPnlValue = positions.reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0,
    );
    const realizedPnlValue = positions.reduce(
      (sum, p) => sum + p.realizedPnl,
      0,
    );

    return toNodeResult(
      createSuccessOutput({
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
        pending_orders: state.pendingOrders,
        pending_orders_count: state.pendingOrders.length,
        trades: state.trades,
        trades_count: state.trades.length,
      }),
    );
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

    return toNodeResult(
      createSuccessOutput({
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
      }),
    );
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

    return toNodeResult(
      createSuccessOutput({
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
      }),
    );
  }

  private backtestGetPendingOrders(simBroker: SimBroker): NodeResult {
    const orders = simBroker.getPendingOrders();
    return toNodeResult(
      createSuccessOutput({ pending_orders: orders, count: orders.length }),
    );
  }

  private backtestGetTrades(simBroker: SimBroker): NodeResult {
    const trades = simBroker.getTrades();
    const totalRealizedPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
    return toNodeResult(
      createSuccessOutput({
        trades,
        count: trades.length,
        total_realized_pnl: totalRealizedPnl,
        winning_trades: trades.filter((t) => t.netPnl > 0).length,
        losing_trades: trades.filter((t) => t.netPnl < 0).length,
      }),
    );
  }

  // ============== BROKER HELPERS ==============

  private brokerGetAll(pm: PortfolioManager): NodeResult {
    const state = pm.getPortfolioState();
    const positions = state.positions;
    const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const unrealizedPnlValue = positions.reduce(
      (s, p) => s + p.unrealizedPnl,
      0,
    );
    const realizedPnlValue = positions.reduce((s, p) => s + p.realizedPnl, 0);

    return toNodeResult(
      createSuccessOutput({
        cash: state.cash,
        positions: positions.map((p) => formatPositionWithPnlPercent(p)),
        positions_count: positions.length,
        positions_value: positionsValue,
        unrealized_pnl: unrealizedPnlValue,
        realized_pnl: realizedPnlValue,
        total_equity: state.totalEquity,
        peak_equity: state.peakEquity,
        drawdown_pct:
          state.peakEquity > 0
            ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
            : 0,
        trades: state.trades,
        trades_count: state.trades.length,
      }),
    );
  }

  private brokerGetPosition(
    pm: PortfolioManager,
    symbols: string[],
  ): NodeResult {
    if (symbols.length === 0) {
      // No symbol provided: return all tracked positions
      const positions = pm.getPositions();
      return toNodeResult(
        createSuccessOutput({
          positions: positions.map((p) => formatPositionWithPnlPercent(p)),
          positions_count: positions.length,
        }),
      );
    }

    if (symbols.length === 1) {
      // Single symbol: keep backward-compatible flat output
      const symbol = symbols[0];
      const position = pm.getPosition(symbol);
      const costBasis = position
        ? Math.abs(position.avgEntryPrice * position.quantity)
        : 0;

      return toNodeResult(
        createSuccessOutput({
          has_position: !!position,
          position: position ? formatPositionWithPnlPercent(position) : null,
          symbol,
          quantity: position?.quantity || 0,
          side: position?.side || null,
          avg_entry_price: position?.avgEntryPrice || 0,
          current_price: position?.currentPrice || 0,
          unrealized_pnl_pct: toPercent(
            position?.unrealizedPnl || 0,
            costBasis,
          ),
          unrealized_pnl: position?.unrealizedPnl || 0,
          realized_pnl_pct: toPercent(position?.realizedPnl || 0, costBasis),
          realized_pnl: position?.realizedPnl || 0,
          market_value: position?.marketValue || 0,
        }),
      );
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

    return toNodeResult(
      createSuccessOutput({ positions: results, positions_count: results.length }),
    );
  }

  private brokerGetCash(pm: PortfolioManager): NodeResult {
    return toNodeResult(
      createSuccessOutput({
        cash: pm.getCash(),
        buying_power: pm.getCash()["USDT"] || 0,
      }),
    );
  }

  private brokerGetEquity(pm: PortfolioManager): NodeResult {
    const state = pm.getPortfolioState();
    const positionsValue = state.positions.reduce(
      (s, p) => s + p.marketValue,
      0,
    );
    return toNodeResult(
      createSuccessOutput({
        total_equity: state.totalEquity,
        cash_usdt: pm.getCash()["USDT"] || 0,
        positions_value: positionsValue,
        peak_equity: state.peakEquity,
        drawdown_pct:
          state.peakEquity > 0
            ? ((state.peakEquity - state.totalEquity) / state.peakEquity) * 100
            : 0,
      }),
    );
  }

  private brokerGetTrades(pm: PortfolioManager): NodeResult {
    const trades = pm.getTrades();
    const totalRealizedPnl = trades.reduce((s, t) => s + t.netPnl, 0);
    return toNodeResult(
      createSuccessOutput({
        trades,
        count: trades.length,
        total_realized_pnl: totalRealizedPnl,
        winning_trades: trades.filter((t) => t.netPnl > 0).length,
        losing_trades: trades.filter((t) => t.netPnl < 0).length,
      }),
    );
  }

  /**
   * Fetch open orders from Binance /api/v3/openOrders (SIGNED).
   * Supports zero, one, or multiple symbols.
   * - No symbols: fetches ALL open orders (no symbol filter).
   * - One symbol: passes symbol param to Binance.
   * - Multiple symbols: fetches ALL and filters client-side.
   */
  private async brokerGetPendingOrders(
    baseUrl: string,
    headers: Record<string, string>,
    creds: any,
    symbols: string[],
    environment: "live" | "testnet" = "live",
  ): Promise<NodeResult> {
    try {
      const timestamp = getBinanceTimestamp(environment, "spot");
      const rawParams: Record<string, any> = { recvWindow: 5000, timestamp };

      // Only pass symbol param for single-symbol queries (Binance API limitation)
      if (symbols.length === 1) {
        rawParams.symbol = symbols[0];
      }

      const signedParams = signHmacSha256(rawParams, creds.secret_key);

      const response = await axios.get(`${baseUrl}/api/v3/openOrders`, {
        headers,
        params: signedParams,
        timeout: 15000,
      });

      let orders = Array.isArray(response.data) ? response.data : [];

      // Client-side filter for multi-symbol queries
      if (symbols.length > 1) {
        const symbolSet = new Set(symbols);
        orders = orders.filter((o: any) => symbolSet.has(o.symbol));
      }

      return toNodeResult(
        createSuccessOutput({ pending_orders: orders, count: orders.length }),
      );
    } catch (err) {
      console.error("[PortfolioExecutor] brokerGetPendingOrders failed:", err);
      return toNodeResult(createErrorOutput(err));
    }
  }
}
