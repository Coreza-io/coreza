import { buildLiveMetrics, normalizeLiveEquitySnapshots } from "../src/lib/liveMetrics";

describe("live metrics regression", () => {
  it("normalizes pnl-style snapshots and avoids absurd annualization", () => {
    const snapshots = [
      { id: "1", snapshot_at: "2026-05-07T10:00:00Z", equity: 0, balances: { USD: 9983.98, debt: -2327.91 } },
      { id: "2", snapshot_at: "2026-05-07T10:01:00Z", equity: 0.1 },
      { id: "3", snapshot_at: "2026-05-07T10:02:00Z", equity: 1.36 },
      { id: "4", snapshot_at: "2026-05-07T10:03:00Z", equity: 0.21 },
    ];

    const normalized = normalizeLiveEquitySnapshots(snapshots as any[], undefined);
    expect(normalized.initialCapital).toBeCloseTo(9983.98, 2);
    expect(normalized.normalizedSnapshots[0].equity).toBeCloseTo(9983.98, 2);
    expect(normalized.normalizedSnapshots[3].equity).toBeCloseTo(9984.19, 2);

    const metrics = buildLiveMetrics(undefined, [{ netPnl: 0.21 }], snapshots as any[]);
    expect(metrics.total_return ?? 0).toBeGreaterThan(0.002);
    expect(metrics.total_return ?? 0).toBeLessThan(0.003);
    expect(Math.abs(metrics.annualized_return ?? 0)).toBeLessThan(1);
    expect(metrics.sharpe_ratio === undefined || Math.abs(metrics.sharpe_ratio) < 100).toBeTruthy();
    expect(metrics.sortino_ratio === undefined || Math.abs(metrics.sortino_ratio) < 100).toBeTruthy();
  });

  it("keeps absolute-equity snapshots unchanged", () => {
    const snapshots = [
      { id: "a", snapshot_at: "2026-05-07T10:00:00Z", equity: 12000 },
      { id: "b", snapshot_at: "2026-05-07T10:01:00Z", equity: 14000 },
    ];
    const normalized = normalizeLiveEquitySnapshots(snapshots as any[], { initial_capital: 12000 });
    expect(normalized.shouldTranslateFromPnl).toBe(false);
    expect(normalized.normalizedSnapshots[1].equity).toBe(14000);
  });
});
