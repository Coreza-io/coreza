import CronExpressionParser from "cron-parser";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { createError } from "../middleware/errorHandler";
import { WorkflowNode } from "../nodes/types";
import { calculateSchedule } from "../utils/scheduleUtils";

export type SchedulerValues = {
  mode?: "every" | "daily" | "weekly" | "monthly" | "cron";
  interval?: "Minutes" | "Hours" | "Days" | "Weeks" | "Months" | "Cron" | "cron";
  count?: string | number;
  minute?: string | number;
  hour?: string | number;
  dom?: string | number;
  dow?: Array<string | number>;
  cron?: string;
  timezone?: string;
};

export interface ScheduleResult {
  cron: string;
  timezone: string;
  next: string;
}

export function computeCron(node: WorkflowNode): ScheduleResult {
  const values = (node.values ?? {}) as SchedulerValues;
  const timezone = values.timezone || "UTC";

  const scheduleResult = calculateSchedule({
    interval: values.interval,
    mode: values.mode,
    count: values.count?.toString(),
    minute: values.minute?.toString(),
    hour: values.hour?.toString(),
    dom: values.dom?.toString(),
    dow: values.dow?.map((value) => value.toString()),
    cron: values.cron,
    timezone,
  });

  const cron = scheduleResult.cronExpression;
  const cronExpression = CronExpressionParser.parse(cron, { tz: timezone });
  const next = cronExpression.next().toDate();
  const scheduledHour = scheduleResult.scheduleHour;
  const scheduledMinute = scheduleResult.scheduleMinute;

  const toScheduledUtc = (date: Date): Date => {
    const zoned = toZonedTime(date, timezone);
    zoned.setHours(scheduledHour, scheduledMinute, 0, 0);
    return fromZonedTime(zoned, timezone);
  };

  const nextInTimezone = toScheduledUtc(next);
  const oneMinuteFromNow = new Date(Date.now() + 60 * 1000);

  if (nextInTimezone < oneMinuteFromNow) {
    throw createError(
      "Invalid cron expression: unable to find a valid future execution time within 100 iterations",
      400,
    );
  }

  return {
    cron,
    timezone,
    next: nextInTimezone.toISOString(),
  };
}
