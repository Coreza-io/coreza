import { BrokerOperation } from "../../types";
import {
  fetchDhanCandles,
  buildDhanModifyOrder,
  buildDhanPlaceOrder,
} from "../helpers";

function getOrderPath(input: any): string {
  if (!input.orderId) {
    throw new Error("orderId is required for this Dhan order operation");
  }

  return `/orders/${encodeURIComponent(String(input.orderId))}`;
}

export const dhanOperations: Record<string, BrokerOperation> = {
  get_account: {
    method: "get",
    path: "/fundlimit",
  },
  get_positions: {
    method: "get",
    path: "/positions",
  },
  get_holdings: {
    method: "get",
    path: "/holdings",
  },
  get_orders: {
    method: "get",
    path: "/orders",
  },
  get_trades: {
    method: "get",
    path: "/trades",
  },
  get_order_by_id: {
    method: "get",
    path: (input: any) => getOrderPath(input),
  },
  place_order: {
    method: "post",
    path: "/orders",
    makeBody: (input: any, creds: any) => buildDhanPlaceOrder(input, creds),
  },
  modify_order: {
    method: "put",
    path: (input: any) => getOrderPath(input),
    makeBody: (input: any, creds: any) => buildDhanModifyOrder(input, creds),
  },
  cancel_order: {
    method: "delete",
    path: (input: any) => getOrderPath(input),
  },
  get_candle: {
    method: "post",
    path: "/charts/intraday",
    execute: fetchDhanCandles,
  },
};
