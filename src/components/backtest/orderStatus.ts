import type { TradeOrder } from "@/hooks/useBacktestResults";

export const getOrderStatusBadgeClass = (status?: TradeOrder["status"] | string) => {
  switch (status) {
    case "Partial":
      return "bg-amber-500/15 text-amber-600 border-amber-500/30 text-xs";
    case "Cancelled":
    case "Rejected":
      return "bg-red-500/15 text-red-600 border-red-500/30 text-xs";
    case "Submitted":
      return "bg-blue-500/15 text-blue-600 border-blue-500/30 text-xs";
    case "Expired":
      return "bg-amber-500/15 text-amber-600 border-amber-500/30 text-xs";
    case "Filled":
    default:
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs";
  }
};
