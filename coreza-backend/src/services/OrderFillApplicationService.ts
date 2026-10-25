import { createHash } from "crypto";
import { supabase } from "../config/supabase";
import { PortfolioManager } from "../simulation/PortfolioManager";
import { NodeExecutionContext } from "../engine/types";
import { NodeResult } from "../nodes/types";
import { FillStreamEvent } from "./FillEventBus";
import { FillDecimal, normalizeOrderFill, OrderFillCheckpoint } from "./orderFillNormalization";

const db = supabase as any;
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
export const brokerFillAccountingEnabled = () => process.env.BROKER_FILL_ACCOUNTING_ENABLED === "true";

export interface BrokerFillPortfolio {
  scope_id: string;
  user_id: string;
  workflow_id: string;
  broker: string;
  account_id: string;
  environment: string;
  version: string;
  baseline_at: string;
  state: ReturnType<PortfolioManager["exportRecoveryState"]>;
  checkpoints: Record<string, OrderFillCheckpoint>;
}

/** SQL owns acceptance. RAM is replaced only from a committed version. */
export class OrderFillApplicationService {
  private static scopes = new WeakMap<PortfolioManager, string>();
  static scope(params: any, context: NodeExecutionContext): string {
    for (const key of ["broker", "brokerAccountId", "environment"]) {
      if (typeof params[key] !== "string" || !params[key].trim() || params[key].includes("{{")) throw new Error(`Map a stable ${key} before enabling broker fill accounting`);
    }
    if (!context.userId || !context.workflowId) throw new Error("Fill accounting requires a workflow owner");
    return hash([context.userId, params.broker.toLowerCase(), params.brokerAccountId, params.environment]);
  }

  /** Explicit deployment/reconciliation action, never called by live ingestion. Refuses replacement. */
  static async establishBaseline(params: any, context: NodeExecutionContext, baseline: {
    state: BrokerFillPortfolio["state"]; checkpoints: BrokerFillPortfolio["checkpoints"]; sourceBoundary: string;
  }): Promise<void> {
    const scope = this.scope(params, context);
    if (!baseline.state.bootstrapped || baseline.state.formatVersion !== 1 || !Number.isFinite(Date.parse(baseline.sourceBoundary))) throw new Error("An initialized, reconciled baseline and source boundary are required");
    for (const [id, order] of baseline.state.orders) {
      const checkpoint = baseline.checkpoints[id];
      if (!checkpoint || checkpoint.symbol !== order.symbol || checkpoint.side !== order.side
        || FillDecimal.from(checkpoint.quantity).cmp(FillDecimal.from(order.filledQty)) !== 0
        || FillDecimal.from(checkpoint.notional).units < 0n) throw new Error(`Missing or inconsistent checkpoint for ${id}`);
    }
    const { data: workflow, error: ownerError } = await db.from("workflows").select("id").eq("id", context.workflowId).eq("user_id", context.userId).maybeSingle();
    if (ownerError) throw ownerError;
    if (!workflow) throw new Error("Workflow ownership is required to establish a fill baseline");
    const { error } = await db.from("broker_fill_portfolios").insert({
      scope_id: scope, user_id: context.userId, workflow_id: context.workflowId,
      broker: params.broker.toLowerCase(), account_id: params.brokerAccountId, environment: params.environment,
      baseline_at: baseline.sourceBoundary, state: baseline.state, checkpoints: baseline.checkpoints,
    });
    if (error) throw error;
  }

  static async recover(pm: PortfolioManager, params: any, context: NodeExecutionContext): Promise<BrokerFillPortfolio> {
    const scope = this.scope(params, context);
    const bound = this.scopes.get(pm);
    if (bound && bound !== scope) throw new Error("One portfolio runner cannot book multiple broker accounts/environments");
    const { data, error } = await db.from("broker_fill_portfolios").select("*").eq("scope_id", scope).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("reconciliation_required: establish an authoritative broker fill baseline before ingestion");
    if (typeof data.version === "number" && !Number.isSafeInteger(data.version)) throw new Error("Portfolio version cannot be represented safely");
    data.version = String(data.version);
    if (data.user_id !== context.userId || data.workflow_id !== context.workflowId) throw new Error("Broker account is owned by another workflow");
    pm.restoreRecoveryState(data.state);
    this.scopes.set(pm, scope);
    return data as BrokerFillPortfolio;
  }

  /** Order registration participates in the same portfolio version as fill acceptance. */
  static async register(pm: PortfolioManager, params: any, context: NodeExecutionContext, apply: (staged: PortfolioManager) => NodeResult): Promise<NodeResult> {
    const receipt = hash([this.scope(params, context), "registration", params.orderId, params.clientOrderId]);
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.recover(pm, params, context);
      const existing = row.state.orders.find(([id]) => id === String(params.orderId))?.[1];
      if (existing) {
        if (existing.symbol !== params.symbol || existing.side !== params.side) throw new Error("Order registration identity changed");
        return { status: "success", data: { order: existing, pendingOrdersCount: pm.getOpenOrders().length } };
      }
      const staged = pm.forkForFill(row.state);
      const result = apply(staged);
      if (result.status === "error") return result;
      const { data, error } = await db.rpc("commit_broker_fill", {
        p_scope: row.scope_id, p_workflow: context.workflowId, p_version: row.version,
        p_receipt: receipt, p_order: null, p_execution: null, p_checkpoint: null,
        p_state: staged.exportRecoveryState(), p_fill: null, p_trade: null, p_decision: { kind: "registration" },
      });
      if (error) throw error;
      if (data.kind === "conflict") continue;
      await this.recover(pm, params, context);
      return result;
    }
    throw new Error("Concurrent portfolio registration; retry registration");
  }

  static async apply(pm: PortfolioManager, params: any, context: NodeExecutionContext) {
    const scope = this.scope(params, context);
    const orderId = String(params.orderId || "");
    const symbol = String(params.symbol || "").trim().toUpperCase();
    const side = String(params.side || "").toLowerCase();
    if (!orderId || !symbol || !["buy", "sell"].includes(side)) throw new Error("Order ID, symbol and BUY/SELL side are required");
    const sourceTimeValue = params.eventTime ?? params.event_time;
    const sourceTime = sourceTimeValue == null || sourceTimeValue === "" ? undefined :
      typeof sourceTimeValue === "number" || /^\d+$/.test(String(sourceTimeValue)) ? Number(sourceTimeValue) : Date.parse(String(sourceTimeValue));
    if (sourceTime !== undefined && !Number.isFinite(sourceTime)) throw new Error("Invalid source event time");
    const seq = params._seq == null || params._seq === "" ? undefined : Number(params._seq);
    if (seq !== undefined && (!Number.isSafeInteger(seq) || seq < 0)) throw new Error("Invalid source sequence");
    const executionId = params.executionId == null || params.executionId === "" ? undefined : String(params.executionId);
    const executionKey = executionId ? hash([orderId, symbol, executionId]) : undefined;
    // CAS retries always normalize against the winning committed state; no staged mutation leaks.
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.recover(pm, params, context);
      const previous = row.checkpoints[orderId];
      const lastSymbolTime = Math.max(0, ...Object.values(row.checkpoints).filter(c => c.symbol === symbol).map(c => c.sourceTime ?? 0));
      const order = row.state.orders.find(([id]) => id === orderId)?.[1];
      if (!order || (!previous && order.filledQty > 0)) throw new Error("reconciliation_required: order needs an explicit zero-fill registration or reconciled checkpoint");
      let executionSeen = false;
      if (executionKey) {
        const { data, error } = await db.from("broker_fill_events").select("receipt_id,decision").eq("scope_id", scope).eq("execution_key", executionKey).maybeSingle();
        if (error) throw error;
        executionSeen = !!data;
        if (data && params.cumulativeFilledQty !== true && params.cumulativeFilledQty !== "true" && params.cumulativeFilledQty !== 1 && params.cumulativeFilledQty !== "1"
          && params.filledQty != null && FillDecimal.from(params.filledQty).cmp(FillDecimal.from(data.decision.deltaQty)) !== 0) {
          return { kind: "reconciliation_required", reason: "Execution identity reused with changed quantity" };
        }
      }
      const decision = normalizeOrderFill({
        quantity: params.filledQty, price: params.avgFillPrice, cumulative: params.cumulativeFilledQty,
        priceMode: params.fillPriceMode, cumulativeQuantity: params.cumulativeOrderQty,
        cumulativeNotional: params.cumulativeQuoteNotional, lastExecutionQty: params.lastExecutionQty,
        executionId, executionSeen, symbol, side: side as "buy" | "sell", sourceTime, sourceSeq: seq,
        fee: params.feeAmount, feeAsset: params.feeAsset,
        coverageComplete: params.fillCoverageComplete === true || params.fillCoverageComplete === "true",
      }, previous);
      if (decision.kind === "invalid" || decision.kind === "reconciliation_required") return decision;
      if (decision.kind === "accepted" && sourceTime === undefined) return { kind: "reconciliation_required", reason: "Map the broker source event time before accepting a fill" };
      if (decision.kind === "accepted" && sourceTime! < lastSymbolTime) return { kind: "reconciliation_required", reason: "Late execution requires replay across orders for this instrument" };
      if (decision.kind === "accepted" && sourceTime! <= Date.parse(row.baseline_at)) return { kind: "reconciliation_required", reason: "Execution predates the controlled source boundary" };
      const stage = pm.forkForFill(row.state);
      const checkpoint: OrderFillCheckpoint = decision.kind === "accepted" ? decision.checkpoint : previous ?? {
        quantity: "0", notional: "0", cumulative: false, priceMode: "execution", symbol, side: side as "buy" | "sell",
      };
      const delta = decision.kind === "accepted" ? {
        quantity: FillDecimal.from(decision.deltaQty).toNumber(), notional: FillDecimal.from(decision.deltaNotional).toNumber(),
        price: decision.executionPrice, fee: FillDecimal.from(decision.fee).toNumber(),
      } : { quantity: 0, notional: 0, price: 0, fee: 0 };
      const quoteAsset = stage.parseInstrument(symbol, params.base_currency || "USDT").quoteAsset;
      if (delta.fee > 0 && params.feeAsset && params.feeAsset !== quoteAsset) {
        return { kind: "reconciliation_required", reason: "Non-quote fee requires reconciled asset conversion and position cost basis" };
      }
      const fillId = hash([scope, orderId, symbol, decision.kind === "accepted" ? (executionKey ?? [checkpoint.quantity, checkpoint.notional]) : "lifecycle"]);
      const receipt = hash([scope, orderId, executionKey, params.status, sourceTime, seq, params.filledQty, params.avgFillPrice]);
      const eventTime = new Date(sourceTime ?? Date.parse(row.baseline_at)).toISOString();
      const trade = stage.applyAcceptedOrderFill({
        orderId, clientOrderId: params.clientOrderId, symbol, side: side as "buy" | "sell",
        status: String(params.status || order?.status || "new").toLowerCase(), _seq: seq,
        origQty: order?.origQty, feeAsset: params.feeAsset,
      }, checkpoint, { ...delta, identity: fillId, time: eventTime, baseCurrency: params.base_currency || "USDT" });
      const state = stage.exportRecoveryState();
      const updatedOrder = state.orders.find(([id]) => id === orderId)![1];
      checkpoint.status = updatedOrder.status;
      // Zero-quantity messages may advance lifecycle, never financial freshness or position snapshots.
      if (decision.kind !== "accepted") {
        checkpoint.sourceTime = previous?.sourceTime;
        checkpoint.sourceSeq = previous?.sourceSeq;
      }
      if (params.positionQty != null && delta.quantity > 0) {
        const snapshotQty = FillDecimal.from(params.positionQty).toNumber();
        const resulting = stage.getPosition(symbol)?.quantity ?? 0;
        if (snapshotQty !== resulting) return { kind: "reconciliation_required", reason: "Absolute position differs from accepted fill; reconcile account positions and fee assets" };
      }
      const event: FillStreamEvent | null = delta.quantity > 0 ? {
        fill_id: fillId, user_id: context.userId!, workflow_id: context.workflowId!, execution_id: context.executionId,
        broker: params.broker, credential_id: params.credential_id, broker_account_id: params.brokerAccountId,
        environment: params.environment, broker_execution_id: executionId, symbol, side: side as "buy" | "sell", order_id: orderId,
        fill_qty_delta: delta.quantity, fill_price: delta.price, quote_qty: delta.notional,
        commission: delta.fee, commission_asset: params.feeAsset, event_time: eventTime,
        fill_status: checkpoint.status, timeInForce: params.timeInForce || "", tag: params.tag || context.nodeId,
      } : null;
      const tradeRow = trade ? {
        trade_key: hash([scope, trade.id]), user_id: context.userId, workflow_id: context.workflowId,
        execution_id: context.executionId, broker_account_id: params.brokerAccountId, environment: params.environment,
        symbol: trade.symbol, action: trade.side, quantity: trade.quantity, entryPrice: trade.entryPrice,
        entryTime: trade.entryTime || null, exitPrice: trade.exitPrice, exitTime: trade.exitTime,
        commission: trade.commission, slippage: trade.slippage, net_pnl: trade.netPnl, gross_pnl: trade.grossPnl,
        entry_order_id: trade.entryOrderId, exit_order_id: trade.exitOrderId, holding_period_bars: trade.holdingPeriodBars,
      } : null;
      const { data, error } = await db.rpc("commit_broker_fill", {
        p_scope: scope, p_workflow: context.workflowId, p_version: row.version, p_receipt: receipt,
        p_order: orderId, p_execution: decision.kind === "accepted" ? executionKey ?? null : null,
        p_checkpoint: checkpoint, p_state: state, p_fill: event, p_trade: tradeRow,
        p_decision: decision,
      });
      if (error) throw error;
      if (data.kind === "conflict") continue;
      // Re-read even after an ambiguous/retried receipt: publish the authoritative winner.
      await this.recover(pm, params, context);
      return { ...decision, committed: true, fillId: event?.fill_id };
    }
    throw new Error("Concurrent portfolio update; retry the source event");
  }
}
