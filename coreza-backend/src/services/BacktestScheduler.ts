import { toZonedTime } from "date-fns-tz";

export interface ScheduleRule {
  id: string;
  type: "every_n_bars" | "time_of_day" | "day_of_week" | "monthly";
  hour?: number;
  minute?: number;
  daysOfWeek?: number[];
  everyNBars?: number;
  dayOfMonth?: number;
  timezone?: string;
}

export interface SchedulerSignal {
  ruleId: string;
  fired: boolean;
  barTimestamp: string;
  barIndex: number;
}

/**
 * Deterministic scheduler for backtests.
 *
 * CRITICAL QC RULE:
 * A scheduled event fires ONLY when the current bar's timestamp matches its rule.
 * If no bar exists at the scheduled time, the schedule does NOT fire.
 *
 * Example: Daily bars with AfterMarketOpen(5min) schedule -> NEVER fires
 * because daily bars have no 09:35 timestamp.
 */
export class BacktestScheduler {
  private rules: ScheduleRule[] = [];
  private lastFiredPeriod = new Map<string, string>();
  private barCounter = 0;
  private readonly warmupBars: number;
  private signals: SchedulerSignal[] = [];

  constructor(warmupBars = 0) {
    this.warmupBars = warmupBars;
  }

  registerRule(rule: ScheduleRule): void {
    this.rules.push(rule);
  }

  checkAndFire(barTimestamp: string | number, barIndex: number): SchedulerSignal[] {
    this.barCounter += 1;
    this.signals = [];

    if (barIndex < 0 || barIndex < this.warmupBars) {
      return this.signals;
    }

    const ts = new Date(barTimestamp);
    if (Number.isNaN(ts.getTime())) {
      return this.signals;
    }

    for (const rule of this.rules) {
      const periodKey = this.getPeriodKey(rule, ts);
      const alreadyFired = this.lastFiredPeriod.get(rule.id) === periodKey;
      if (alreadyFired) continue;

      if (this.shouldFire(rule, ts)) {
        this.lastFiredPeriod.set(rule.id, periodKey);
        this.signals.push({
          ruleId: rule.id,
          fired: true,
          barTimestamp: ts.toISOString(),
          barIndex,
        });
      }
    }

    return this.signals;
  }

  private getPeriodKey(rule: ScheduleRule, ts: Date): string {
    const zoned = this.getRuleDate(ts, rule.timezone);
    const year = zoned.getFullYear();
    const month = String(zoned.getMonth() + 1).padStart(2, "0");
    const day = String(zoned.getDate()).padStart(2, "0");

    switch (rule.type) {
      case "time_of_day":
        return `daily:${year}-${month}-${day}`;
      case "day_of_week": {
        const week = this.getWeekOfYear(zoned);
        return `weekly:${year}-W${String(week).padStart(2, "0")}`;
      }
      case "monthly":
        return `monthly:${year}-${month}`;
      case "every_n_bars":
        return `bar:${this.barCounter}`;
      default:
        return `default:${year}-${month}-${day}`;
    }
  }

  private shouldFire(rule: ScheduleRule, ts: Date): boolean {
    const ruleDate = this.getRuleDate(ts, rule.timezone);

    switch (rule.type) {
      case "time_of_day":
        return (
          ruleDate.getHours() === (rule.hour ?? 0)
          && ruleDate.getMinutes() === (rule.minute ?? 0)
        );
      case "day_of_week":
        return (rule.daysOfWeek || []).includes(ruleDate.getDay());
      case "every_n_bars": {
        const n = Math.max(1, rule.everyNBars || 1);
        return this.barCounter % n === 0;
      }
      case "monthly":
        return ruleDate.getDate() === (rule.dayOfMonth || 1);
      default:
        return false;
    }
  }

  private getRuleDate(ts: Date, timezone?: string): Date {
    if (!timezone || timezone.toUpperCase() === "UTC") {
      return new Date(ts.getTime());
    }

    try {
      return toZonedTime(ts, timezone);
    } catch (_error) {
      return new Date(ts.getTime());
    }
  }

  private getWeekOfYear(date: Date): number {
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  getLastSignals(): SchedulerSignal[] {
    return this.signals;
  }

  reset(): void {
    this.rules = [];
    this.lastFiredPeriod.clear();
    this.barCounter = 0;
    this.signals = [];
  }
}
