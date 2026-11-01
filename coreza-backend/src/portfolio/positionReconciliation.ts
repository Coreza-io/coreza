import { decimal } from "./decimal";

export interface PositionReconciliation {
  orderId: string;
  executionId?: string;
  accountScope: string;
  timestamp: string;
  brokerPositionQty?: string;
  netPositionDelta: string;
  baseFeeQty: string;
  feeAsset?: string;
  feeSource: "broker_explicit" | "unknown";
  reconciliationStatus: "reconciled" | "reconciliation_pending";
  reason?: string;
}

/** An account snapshot alone does not prove a fee or a strategy's inventory.
 * Until independently ordered broker evidence is available, discrepancies stay
 * pending. In particular, never infer a fee from gross minus absolute position. */
export function reconcilePosition(input: {
  orderId: string; executionId?: string; accountScope: string; timestamp: string;
  brokerPositionQty?: string | number; attributedQty: string;
  netPositionDelta: string; baseFeeQty: string; feeAsset?: string;
  explicitFee: boolean;
}): PositionReconciliation {
  const brokerQty = input.brokerPositionQty == null ? undefined : decimal(input.brokerPositionQty);
  if (brokerQty && brokerQty.compare(0) < 0) throw new Error("Negative broker position requires a short-position model");
  const reason = !brokerQty ? "missing_broker_position"
    : brokerQty.compare(input.attributedQty) !== 0 ? "unverified_account_position_discrepancy" : undefined;
  return {
    orderId: input.orderId, executionId: input.executionId, accountScope: input.accountScope,
    timestamp: input.timestamp, brokerPositionQty: brokerQty?.toString(),
    netPositionDelta: input.netPositionDelta, baseFeeQty: input.baseFeeQty,
    feeAsset: input.feeAsset, feeSource: input.explicitFee ? "broker_explicit" : "unknown",
    reconciliationStatus: reason ? "reconciliation_pending" : "reconciled", reason,
  };
}
