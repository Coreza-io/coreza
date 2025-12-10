import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioSnapshot } from "@/hooks/useBacktestResults";

interface PortfolioTimelineProps {
  snapshots: PortfolioSnapshot[];
}

export const PortfolioTimeline = ({ snapshots }: PortfolioTimelineProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No portfolio snapshots available.</p>
        ) : (
          <div className="space-y-3">
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-center justify-between rounded-lg border p-3 bg-muted/30"
              >
                <div>
                  <p className="text-sm font-medium">{new Date(snapshot.timestamp).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Daily return: {snapshot.daily_return ? `${snapshot.daily_return.toFixed(2)}%` : '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">${snapshot.equity.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Cash: ${snapshot.cash?.toLocaleString() || '—'} | Positions: ${snapshot.positions_value?.toLocaleString() || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
