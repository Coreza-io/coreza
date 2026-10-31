// Binance Futures validation at the broker payload boundary for all execution
// paths. Account position mode is not inferred here.
export function validateFuturesOrder(input: Record<string, any>): void {
  const type = String(input.type || "").toUpperCase();
  const priced = ["LIMIT", "STOP", "TAKE_PROFIT"].includes(type);
  const triggered = ["STOP", "TAKE_PROFIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(type);
  const closeable = ["STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(type);
  const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== "";
  const closePosition = input.closePosition === true;
  const reduceOnly = input.reduceOnly === true || input.reduceOnly === "true";

  if (closePosition && hasValue(input.quantity)) {
    throw new Error("quantity cannot be sent when closePosition=true");
  }
  if (closePosition && reduceOnly) {
    throw new Error("reduceOnly cannot be sent when closePosition=true");
  }
  if (closePosition && !closeable) {
    throw new Error("closePosition is only supported for STOP_MARKET/TAKE_PROFIT_MARKET");
  }
  if (!closePosition && !hasValue(input.quantity)) {
    throw new Error(`quantity is required for ${type}`);
  }
  if (priced) {
    const hasPrice = hasValue(input.price);
    const hasPriceMatch = hasValue(input.priceMatch) && input.priceMatch !== "NONE";
    if (hasPrice && hasPriceMatch) {
      throw new Error("price cannot be sent together with priceMatch");
    }
    if (!hasPrice && !hasPriceMatch) {
      throw new Error("Exactly one of price or priceMatch is required for this order type");
    }
  }
  if (triggered && !hasValue(input.stopPrice)) {
    throw new Error("stopPrice is required for this order type");
  }
  if (type === "TRAILING_STOP_MARKET") {
    const quantity = Number(input.quantity);
    if (!["string", "number"].includes(typeof input.quantity) || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("quantity must be a positive number for TRAILING_STOP_MARKET");
    }
    if (!hasValue(input.callbackRate)) {
      throw new Error("callbackRate is required for TRAILING_STOP_MARKET");
    }
    const rate = Number(input.callbackRate);
    if (!["string", "number"].includes(typeof input.callbackRate) || !Number.isFinite(rate) || rate < 0.1 || rate > 10) {
      throw new Error("callbackRate must be a number between 0.1 and 10 for TRAILING_STOP_MARKET");
    }
  }

  // These parameter combinations are invalid regardless of the actual account
  // mode. Binance remains authoritative for account-mode compatibility.
  if (reduceOnly && ["LONG", "SHORT"].includes(input.positionSide)) {
    throw new Error("reduceOnly=true cannot be used with positionSide LONG/SHORT; use Hedge Mode closing orders instead");
  }
  const side = String(input.side || "").toUpperCase();
  if (closePosition && ((input.positionSide === "LONG" && side === "BUY") || (input.positionSide === "SHORT" && side === "SELL"))) {
    throw new Error("closePosition requires SELL for positionSide LONG or BUY for positionSide SHORT");
  }
}
