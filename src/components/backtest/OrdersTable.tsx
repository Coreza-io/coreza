import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Download } from "lucide-react";
import { LiveOrder } from "@/hooks/useLiveOrders";
import { getOrderStatusBadgeClass } from "./orderStatus";

interface OrdersTableProps {
  orders: LiveOrder[];
}

const formatTime = (time?: string | null) =>
  time ? new Date(time).toLocaleString() : "—";

const formatPrice = (price?: number | null, quoteAsset?: string) =>
  price == null
    ? "—"
    : `${price.toFixed(4)}${quoteAsset ? ` ${quoteAsset}` : ""}`;

const formatNumber = (value?: number | null) =>
  value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 8 });

const csvEscape = (value: unknown) => {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

const getAlgoBadgeClass = (status?: string) => {
  switch (status) {
    case "Untriggered":
      return "bg-muted text-muted-foreground border-border text-xs ml-2";
    case "Triggering":
      return "bg-blue-500/15 text-blue-600 border-blue-500/30 text-xs ml-2";
    case "Triggered":
      return "bg-cyan-500/15 text-cyan-600 border-cyan-500/30 text-xs ml-2";
    case "Finished":
      return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-xs ml-2";
    case "Rejected":
      return "bg-red-500/15 text-red-600 border-red-500/30 text-xs ml-2";
    case "Expired":
      return "bg-amber-500/15 text-amber-600 border-amber-500/30 text-xs ml-2";
    case "Canceled":
    case "Cancelled":
      return "bg-muted text-muted-foreground border-border text-xs ml-2";
    default:
      return "bg-muted text-muted-foreground border-border text-xs ml-2";
  }
};

export const OrdersTable = ({ orders }: OrdersTableProps) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (orderId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const downloadCsv = () => {
    const headers = [
      "Date Time",
      "Order ID",
      "Symbol",
      "Type",
      "Fill Price",
      "Stop Price",
      "Limit Price",
      "Quantity",
      "Status",
      "Tag",
      "Commission",
      "Commission Asset",
    ];

    const rows = orders.map((order) => [
      order.time,
      order.orderId,
      order.symbol,
      order.orderType,
      order.avgFillPrice,
      order.stopPrice ?? "",
      order.limitPrice ?? "",
      order.quantity,
      order.status,
      order.tag ?? "",
      order.totalCommission,
      order.commissionAsset ?? "",
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const orderCount = useMemo(() => orders.length, [orders]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Orders</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{orderCount} orders</Badge>
            <Button variant="ghost" size="sm" onClick={downloadCsv}>
              <Download className="h-4 w-4 mr-2" />
              Download Orders
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="overflow-auto">
        <div className="min-w-[980px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Date Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No orders yet.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => {
                  const expanded = expandedIds.has(order.orderId);

                  return (
                    <Fragment key={order.orderId}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(order.orderId)}
                      >
                        <TableCell className="w-8 px-2">
                          {expanded ? (
                            <span className="font-medium text-muted-foreground">−</span>
                          ) : (
                            <span className="font-medium text-muted-foreground">+</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {formatTime(order.time)}
                        </TableCell>
                        <TableCell>{order.symbol || "—"}</TableCell>
                        <TableCell>
                          <div className="font-medium">{order.orderType || "-"}</div>
                          {order.algoStatus && (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className={getAlgoBadgeClass(order.algoStatus)}>
                                    {order.algoStatus}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-xs">
                                    {order.algoRejectReason ? `Reason: ${order.algoRejectReason}` : "Algo parent"}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5 text-xs">
                            <div>Fill: {formatPrice(order.avgFillPrice, order.quoteAsset)}</div>
                            {order.stopPrice != null && <div>Stop: {formatPrice(order.stopPrice, order.quoteAsset)}</div>}
                            {order.limitPrice != null && <div>Limit: {formatPrice(order.limitPrice, order.quoteAsset)}</div>}
                          </div>
                        </TableCell>
                        <TableCell>{formatNumber(order.quantity)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getOrderStatusBadgeClass(order.status)}>
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{order.tag || "-"}</TableCell>
                      </TableRow>

                      {expanded && order.algoStatus && (
                        <TableRow className="bg-muted/30 text-xs">
                          <TableCell />
                          <TableCell className="text-muted-foreground">{formatTime(order.time)}</TableCell>
                          <TableCell>{order.symbol}</TableCell>
                          <TableCell colSpan={2}>
                            <span className="font-medium">Algo Parent</span>
                          </TableCell>
                          <TableCell>—</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={getAlgoBadgeClass(order.algoStatus)}>
                              {order.algoStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>{order.tag || "-"}</TableCell>
                        </TableRow>
                      )}

                      {expanded &&
                        order.fills.map((fill) => (
                          <TableRow key={fill.id} className="bg-muted/30 text-xs">
                            <TableCell />
                            <TableCell className="text-muted-foreground whitespace-nowrap">
                              {formatTime(fill.time)}
                            </TableCell>
                            <TableCell>{order.symbol}</TableCell>
                            <TableCell>Fill</TableCell>
                            <TableCell>{formatPrice(fill.price, order.quoteAsset)}</TableCell>
                            <TableCell>{formatNumber(fill.quantity)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getOrderStatusBadgeClass(fill.status)}>
                                {fill.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{order.tag || "-"}</TableCell>
                          </TableRow>
                        ))}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
