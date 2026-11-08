import BigNumber from "bignumber.js";
import type { BrokerOperationExecuteContext } from "../types";
import { decimal } from "../../portfolio/decimal";
import { getBinanceTimestamp } from "../../utils/binanceTimeSync";
import { signHmacSha256 } from "../../utils/crypto";

const Amount = BigNumber.clone({ DECIMAL_PLACES: 72, ROUNDING_MODE: BigNumber.ROUND_DOWN });
const present = (value: unknown) => value !== undefined && value !== null && value !== "";
const positive = (value: unknown, label: string) => {
  const amount = new Amount(decimal(typeof value === "number" ? value : String(value).trim()).toString());
  if (!amount.isFinite() || amount.lte(0)) throw new Error(`${label} must be positive`);
  return amount;
};
const gcd = (a: bigint, b: bigint): bigint => {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

/** Spot has balances, not position-close orders: sell only available base inventory. */
export async function closeBinanceSpotPosition({ input, creds, baseUrl, headers, request }: BrokerOperationExecuteContext) {
  const market = input.marketType ?? input.asset_type ?? input.assetType;
  if (market !== undefined && market !== "spot" && market !== "crypto") throw new Error("Close Position supports Binance Spot only");
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error("Close Position requires a Binance pair such as ETHUSDT");
  const hasQty = present(input.qty), hasPercentage = present(input.percentage);
  if (hasQty && hasPercentage) throw new Error("Provide either quantity or percentage, not both");
  const requested = hasQty ? positive(input.qty, "Quantity") : undefined;
  const percentage = hasPercentage ? positive(input.percentage, "Percentage") : new Amount(100);
  if (percentage.gt(100)) throw new Error("Percentage must be greater than 0 and at most 100");
  const environment = input.environment === "live" ? "live" : "testnet";
  const signed = (params: Record<string, unknown>) => signHmacSha256(params, creds.secret_key);
  const timestamp = () => getBinanceTimestamp(environment, "spot");
  const { data: exchange } = await request.get(`${baseUrl}/api/v3/exchangeInfo`, { params: { symbol }, timeout: 15000 });
  const instrument = exchange.symbols?.find((item: any) => item.symbol === symbol);
  if (!instrument || instrument.status !== "TRADING" || instrument.isSpotTradingAllowed === false || !instrument.orderTypes?.includes("MARKET")) {
    throw new Error("This pair is not available for Spot market orders");
  }
  const precision = instrument.baseAssetPrecision;
  const filters = Array.isArray(instrument.filters)
    ? instrument.filters.filter((filter: any) => ["LOT_SIZE", "MARKET_LOT_SIZE"].includes(filter.filterType)) : [];
  if (!filters.some((filter: any) => filter.filterType === "LOT_SIZE") || !Number.isInteger(precision) || precision < 0 || precision > 30) {
    throw new Error("Missing Binance quantity rules for this pair");
  }
  const steps: BigNumber[] = [new Amount(1).shiftedBy(-precision)];
  for (const filter of filters) {
    for (const key of ["stepSize", "minQty", "maxQty"]) {
      const value = new Amount(filter[key]);
      if (!value.isFinite() || value.lt(0)) throw new Error("Invalid Binance quantity rules");
    }
    if (new Amount(filter.stepSize).gt(0)) steps.push(new Amount(filter.stepSize));
  }
  const { data: account } = await request.get(`${baseUrl}/api/v3/account`, {
    headers, params: signed({ recvWindow: 60000, timestamp: timestamp() }), timeout: 15000,
  });
  if (account.canTrade === false) throw new Error("Trading is disabled for this Binance account");
  const balance = account.balances?.find((item: any) => item.asset === instrument.baseAsset);
  const available = new Amount(decimal(String(balance?.free ?? "0")).toString());
  if (available.lte(0)) throw new Error(`No available ${instrument.baseAsset} balance to close`);
  if (requested?.gt(available)) throw new Error("Close quantity exceeds the available Spot balance");
  let quantity = requested ?? available.times(percentage).dividedBy(100);
  // A common increment satisfies LOT_SIZE, MARKET_LOT_SIZE and asset precision.
  const scale = Math.max(...steps.map(step => step.decimalPlaces()!));
  const increment = steps.map(step => BigInt(step.shiftedBy(scale).toFixed(0)))
    .reduce((a, b) => a / gcd(a, b) * b);
  const step = new Amount(increment.toString()).shiftedBy(-scale);
  quantity = quantity.dividedToIntegerBy(step).times(step);
  if (quantity.lte(0)) throw new Error("Available close quantity is below the pair's permitted increment");
  for (const filter of filters) {
    if (quantity.lt(filter.minQty) || (new Amount(filter.maxQty).gt(0) && quantity.gt(filter.maxQty))) {
      throw new Error(`Close quantity violates Binance ${filter.filterType} limits`);
    }
  }
  // Submit once. Binance remains authoritative for notional and other dynamic filters.
  const { data } = await request.post(`${baseUrl}/api/v3/order`, null, {
    headers, timeout: 15000,
    params: signed({ symbol, side: "SELL", type: "MARKET", quantity: quantity.toFixed(), newOrderRespType: "FULL",
      ...(input._idempotencyKey ? { newClientOrderId: input._idempotencyKey } : {}),
      recvWindow: 60000, timestamp: timestamp() }),
  });
  return data;
}
