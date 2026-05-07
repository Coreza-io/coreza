import { Link, useParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EquityCurveChart } from "@/components/backtest/EquityCurveChart";
import { PerformanceMetricsCard } from "@/components/backtest/PerformanceMetricsCard";
import { TradesTable } from "@/components/backtest/TradesTable";
import { OrdersTable } from "@/components/backtest/OrdersTable";
import { useBacktestResults } from "@/hooks/useBacktestResults";
import { useLiveStrategyDetail } from "@/hooks/useLiveStrategyDetail";
import { aggregateFillsToOrders } from "@/hooks/useLiveOrders";
import {
  ArrowLeft,
  Download,
  Workflow,
  Clock3,
  Calendar,
  DollarSign,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export type BacktestResultsMode = "backtest" | "live";

const statusVariants: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
};

interface BacktestResultsProps {
  mode?: BacktestResultsMode;
}

const BacktestResults = ({ mode = "backtest" }: BacktestResultsProps) => {
  const { id } = useParams();
  const isLive = mode === "live";

  const backtestData = useBacktestResults(id, !isLive);
  const liveData = useLiveStrategyDetail(id, isLive);
  const { backtest, metrics, trades, snapshots, loading } = isLive
    ? liveData
    : backtestData;
  const liveOrdersResult = isLive
    ? aggregateFillsToOrders(liveData.rawFills ?? [])
    : { orders: [] };

  const backPath = isLive ? "/dashboard/live" : "/dashboard/backtests";
  const pageLabel = isLive ? "Live Strategy" : "Backtest";

  const renderHeader = () => {
    if (loading || !backtest) {
      return (
        <div className="space-y-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{backtest.name}</h1>
          <Badge
            variant={statusVariants[backtest.status] || "outline"}
            className="capitalize"
          >
            {backtest.status}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Clock3 className="h-4 w-4" />
            {backtest.started_at
              ? new Date(backtest.started_at).toLocaleString()
              : "Not started"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4" />
            <span>Workflow:</span>
            <Link
              to={`/dashboard/workflow/${backtest.workflow_id}`}
              className="text-primary hover:underline"
            >
              {backtest.workflow_id}
            </Link>
          </div>
        </div>
      </div>
    );
  };

  const metricCards = [
    {
      label: "Net Profit",
      value: metrics?.net_profit,
      format: "currency" as const,
      colored: true,
    },
    {
      label: "Total Return",
      value: metrics?.total_return,
      format: "percent" as const,
      colored: true,
    },
    {
      label: "Sharpe Ratio",
      value: metrics?.sharpe_ratio,
      format: "number" as const,
    },
    { label: "Win Rate", value: metrics?.win_rate, format: "percent" as const },
  ];

  const formatMetric = (
    value?: number | null,
    format: "percent" | "number" | "currency" = "number",
  ) => {
    if (value === undefined || value === null || !Number.isFinite(value)) return "—";
    if (format === "percent") return `${value.toFixed(2)}%`;
    if (format === "currency")
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return value.toFixed(2);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" asChild>
            <Link to={backPath} className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
          {renderHeader()}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary">
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metricCards.map((metric) => {
          const val = metric.value;
          const colorClass =
            metric.colored && val != null
              ? val >= 0
                ? "text-emerald-600"
                : "text-red-600"
              : "";
          return (
            <Card key={metric.label}>
              <CardHeader className="pb-2">
                <CardDescription>{metric.label}</CardDescription>
                <CardTitle className={`text-2xl ${colorClass}`}>
                  {formatMetric(val, metric.format)}
                </CardTitle>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      <EquityCurveChart snapshots={snapshots} />

      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="trades">Trades</TabsTrigger>
          {isLive && <TabsTrigger value="orders">Orders</TabsTrigger>}
          {!isLive && <TabsTrigger value="settings">Settings</TabsTrigger>}
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <PerformanceMetricsCard metrics={metrics} />
        </TabsContent>

        <TabsContent value="trades">
          <TradesTable trades={trades} />
        </TabsContent>
        {isLive && (
          <TabsContent value="orders">
            <OrdersTable
              orders={liveOrdersResult.orders}
            />
          </TabsContent>
        )}

        {!isLive && (
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>{pageLabel} Configuration</CardTitle>
                <CardDescription>
                  Settings used during this {pageLabel.toLowerCase()} run.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {backtest ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="p-3 rounded-lg border bg-muted/40">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Date Range
                      </p>
                      <p className="text-sm font-medium">
                        {backtest.start_date} to {backtest.end_date}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/40">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <DollarSign className="h-3 w-3" /> Initial Capital
                      </p>
                      <p className="text-sm font-medium">
                        $
                        {backtest.initial_capital?.toLocaleString() || "10,000"}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/40">
                      <p className="text-xs text-muted-foreground">
                        Data Frequency
                      </p>
                      <p className="text-sm font-medium">
                        {backtest.data_frequency || "1d"}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/40">
                      <p className="text-xs text-muted-foreground">
                        Commission Rate
                      </p>
                      <p className="text-sm font-medium">
                        {((backtest.commission_rate || 0) * 100).toFixed(2)}%
                      </p>
                    </div>
                    <div className="p-3 rounded-lg border bg-muted/40">
                      <p className="text-xs text-muted-foreground">
                        Slippage Rate
                      </p>
                      <p className="text-sm font-medium">
                        {((backtest.slippage_rate || 0) * 100).toFixed(2)}%
                      </p>
                    </div>
                    {backtest.description && (
                      <div className="p-3 rounded-lg border bg-muted/40 col-span-full">
                        <p className="text-xs text-muted-foreground">
                          Description
                        </p>
                        <p className="text-sm font-medium">
                          {backtest.description}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No configuration available.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default BacktestResults;
