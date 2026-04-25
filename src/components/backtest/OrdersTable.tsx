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

export const OrdersTable = ({ orders }: OrdersTableProps) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()),
    [orders],
  );

  const toggleExpand = (rowId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const downloadCsv = () => {
    const headers = [
      "Date Time",
      "Order ID",
      "Algo ID",
      "Symbol",
      "Type",
      "Time In Force",
      "Price",
      "Stop Price",
      "Limit/Trigger Price",
      "Trail Price",
      "Trail Percent",
      "Quantity",
      "Status",
      "Tag",
      "Commission",
      "Commission Asset",
      "Reject Reason",
    ];

    const rows = sortedOrders.map((order) => [
      order.time,
      order.orderId ?? "",
      order.algoId ?? "",
      order.symbol,
      order.orderType,
      order.timeInForce ?? "",
      order.avgFillPrice,
      order.stopPrice ?? "",
      order.limitPrice ?? "",
      order.trailPrice ?? "",
      order.trailPercent ?? "",
      order.quantity,
      order.status,
      order.tag ?? "",
      order.totalCommission,
      order.commissionAsset ?? "",
      order.rejectReason ?? "",
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

  const summaryText = useMemo(() => `${orders.length} orders`, [orders.length]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Orders</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{summaryText}</Badge>
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
              {sortedOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No orders yet.
                  </TableCell>
                </TableRow>
              ) : (
                sortedOrders.map((order, index) => {
                  const rowId = order.algoId ?? order.orderId ?? `row-${index}`;
                  const expanded = expandedIds.has(rowId);

                  return (
                    <Fragment key={rowId}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(rowId)}
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
                          <div className="flex flex-col gap-1">
                            <div className="font-medium">{order.orderType || "-"}</div>
                            {order.algoId ? (
                              <Badge variant="outline" className="w-fit text-xs">
                                Algo
                              </Badge>
                            ) : null}
                          </div>
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

                      {expanded && (
                        <>
                          <TableRow className="bg-muted/20 text-xs">
                            <TableCell />
                            <TableCell colSpan={7}>
                              <div className="flex flex-wrap gap-4">
                                {order.algoId ? <span>Algo ID: {order.algoId}</span> : null}
                                {order.orderId ? <span>Order ID: {order.orderId}</span> : null}
                                {order.timeInForce ? <span>TIF: {order.timeInForce}</span> : null}
                                {order.trailPrice != null ? (
                                  <span>Trail Price: {formatPrice(order.trailPrice, order.quoteAsset)}</span>
                                ) : null}
                                {order.trailPercent != null ? (
                                  <span>Trail %: {formatNumber(order.trailPercent)}</span>
                                ) : null}
                                {order.rejectReason ? <span>Reject Reason: {order.rejectReason}</span> : null}
                              </div>
                            </TableCell>
                          </TableRow>

                          {order.events.map((event) => (
                            <TableRow key={event.id} className="bg-muted/30 text-xs">
                              <TableCell />
                              <TableCell className="text-muted-foreground whitespace-nowrap">
                                {formatTime(event.time)}
                              </TableCell>
                              <TableCell>{order.symbol || "—"}</TableCell>
                              <TableCell>{event.kind === "algo" ? "Algo" : "Order"}</TableCell>
                              <TableCell>
                                {event.price != null ? formatPrice(event.price, order.quoteAsset) : "—"}
                              </TableCell>
                              <TableCell>
                                {event.quantity != null ? formatNumber(event.quantity) : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getOrderStatusBadgeClass(event.status)}>
                                  {event.status}
                                </Badge>
                              </TableCell>
                              <TableCell>{event.rejectReason || order.tag || "-"}</TableCell>
                            </TableRow>
                          ))}
                        </>
                      )}
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
