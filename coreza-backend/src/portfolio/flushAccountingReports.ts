import { reportingTradeId } from "../reporting/persistence";
import { supabase } from "../config/supabase";
import { LiveFillRepository } from "../repositories/LiveFillRepository";
import { LiveTradeRepository } from "../repositories/LiveTradeRepository";
import { AccountingEvent, AcceptedExecution, BookScope } from "./accounting";
import { decimal } from "./decimal";

/** Durable outbox: retry the same derived IDs until every reporting write confirms.
 * Accounting acceptance never depends on the replaceable Redis snapshot cache. */
export async function flushAccountingReports(): Promise<void> {
  if (process.env.PORTFOLIO_ACCOUNTING_V2_ENABLED !== "true" && process.env.PORTFOLIO_ACCOUNTING_V2_STORAGE_READY !== "true") return;
  const db = supabase as any;
  const { data: rows, error } = await db.from("portfolio_accounting_events")
    .select("book_key,event_id,payload,portfolio_accounting_books!inner(scope)")
    .is("reported_at", null).order("accepted_at", { ascending: true }).limit(100);
  if (error) throw error;
  for (const row of rows ?? []) {
    const scope = row.portfolio_accounting_books.scope as BookScope;
    const { input, execution } = row.payload as { input: AccountingEvent; execution: AcceptedExecution | null };
    if (execution) {
      await LiveFillRepository.batchUpsert([{
        user_id: scope.userId, workflow_id: scope.workflowId, execution_id: scope.activationId,
        broker: scope.broker, credential_id: scope.credentialId, symbol: input.symbol, fill_id: execution.id,
        order_id: input.orderId, broker_execution_id: input.executionId, side: input.side,
        price: decimal(execution.price).toNumber(), qty: decimal(execution.quantity).toNumber(), quote_qty: decimal(execution.notional).toNumber(),
        commission: decimal(execution.fee).toNumber(), commission_asset: input.feeAsset, event_time: input.timestamp, fill_status: input.status,
      }]);
      if (input.side === "sell" && execution.positionBefore) {
        const entry = execution.positionBefore;
        // Same shared-reporting UUID scheme as PortfolioExecutor, derived from the
        // activation and durable execution identity, never from a replay counter.
        const id = reportingTradeId(scope.activationId, `LT-${execution.id}`);
        await LiveTradeRepository.insert({ id, user_id: scope.userId, workflow_id: scope.workflowId, execution_id: scope.activationId,
          symbol: input.symbol, action: "buy", quantity: decimal(execution.quantity).toNumber(),
          entryPrice: decimal(entry.grossCost).div(entry.quantity).toNumber(), entryTime: entry.entryTime,
          exitPrice: decimal(execution.price).toNumber(), exitTime: input.timestamp,
          commission: decimal(execution.allocatedEntryFee).add(execution.fee).toNumber(), slippage: 0,
          net_pnl: decimal(execution.netRealized).toNumber(), gross_pnl: decimal(execution.grossRealized).toNumber(),
          entry_order_id: entry.entryOrderId, exit_order_id: input.orderId, holding_period_bars: 0 });
      }
    }
    const { error: ackError } = await db.from("portfolio_accounting_events").update({ reported_at: new Date().toISOString() }).eq("book_key", row.book_key).eq("event_id", row.event_id).select("event_id").single();
    if (ackError) throw ackError;
  }
}
