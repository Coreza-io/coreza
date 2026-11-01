import type { BrokerRequestContext } from "../../types";
import { PortfolioManager } from "../../../simulation/PortfolioManager";
import { assertAlpacaSellable } from "../portfolioHelpers";
import { decimal } from "../../../portfolio/decimal";

/** Check the actual request after async preparation: Alpaca's body builder
 * prioritizes notional over qty, so input qty alone cannot enforce a sell cap. */
export function prepareAlpacaRequest({
  operation, input, path, params, body, userId, executionId, reportingExecutionId, credentialId,
}: BrokerRequestContext): void {
  if (operation !== "close_position" &&
    !(operation === "place_order" && String(body?.side).toLowerCase() === "sell")) return;

  const activationId = reportingExecutionId ?? executionId;
  const pm = activationId ? PortfolioManager.existingInstance(userId, activationId) : undefined;
  const sellable = pm ? assertAlpacaSellable(pm,
    JSON.stringify(["alpaca", input.environment === "live" ? "live" : "paper", credentialId]),
    operation === "place_order" ? body?.symbol : decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)),
    operation === "place_order" ? body?.qty : params.qty,
    operation === "place_order",
  ) : undefined;
  if (operation === "close_position" && sellable != null && params.qty == null) {
    const percentage = decimal(params.percentage ?? 100);
    if (percentage.compare(0) < 0 || percentage.compare(100) > 0) throw new Error("percentage must be between 0 and 100");
    params.qty = decimal(sellable).mul(percentage).div(100).toString();
    delete params.percentage;
  }
}
