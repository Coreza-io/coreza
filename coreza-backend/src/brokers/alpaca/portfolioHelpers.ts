import { decimal } from "../../portfolio/decimal";
import type { InventoryQuantityResolver } from "../../portfolio/fillAccounting";

/** Alpaca can report net holdings without an explicit fee. Use the absolute
 * position to determine this BUY's inventory increase, without declaring a fee.
 * This assumes the portfolio and broker snapshot cover the same inventory. */
export const resolveAlpacaInventoryQuantity: InventoryQuantityResolver = ({
  symbol, side, grossQuantity, defaultInventoryQuantity, previousPositionQty, brokerPositionQty, fee,
}) => {
  if (!symbol.includes("/") || side !== "buy" || brokerPositionQty == null || decimal(fee).compare(0) !== 0) return defaultInventoryQuantity;
  const netReceived = decimal(brokerPositionQty).sub(previousPositionQty);
  if (netReceived.compare(0) <= 0 || netReceived.compare(grossQuantity) > 0) {
    throw new Error("Alpaca broker position must represent a positive BUY increase no greater than the gross fill");
  }
  return netReceived.toString();
};
