/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import CronExpressionParser from "cron-parser";
import { toZonedTime } from "date-fns-tz";
import { createError, type AppError } from "../middleware/errorHandler";

export type SchedulerInput = {
  interval?: string;
  mode?: string;
  count?: string;
  minute?: string;
  hour?: string;
  dom?: string;
  dow?: string[];
  cron?: string;
  timezone?: string;
};

export type SchedulerCalculation = {
  cronExpression: string;
  nextExecution: Date;
  interval: string;
  intervalCount: number;
  scheduleHour: number;
  scheduleMinute: number;
  timezone: string;
  dow?: string[];
};

export function calculateSchedule(input: SchedulerInput): SchedulerCalculation {
  const timezone = input.timezone || "UTC";
  const interval = input.interval || "Weeks";
  const nowInUserTz = toZonedTime(new Date(), timezone);
  const intervalCount = clampInt(input.count, 1, 1, 10000);
  const scheduleHour = resolveNumber(input.hour, nowInUserTz.getHours(), 0, 23);
  const scheduleMinute = resolveNumber(
    input.minute,
    nowInUserTz.getMinutes(),
    0,
    59
  );

  let dowValues: string[] | undefined;
  dowValues = input.dow;

  if (interval === "Weeks") {
    if (!dowValues || !Array.isArray(dowValues) || dowValues.length === 0) {
      throw createError(
        'dow (days of week) is required for weekly intervals as an array (e.g., ["1", "5"] for Monday and Friday)',
        400
      );
    }
  }

  const cronExpression = buildCronExpression(
    interval,
    intervalCount,
    scheduleHour,
    scheduleMinute,
    dowValues,
    input.cron
  );

  const nextExecution = resolveNextExecution({
    interval,
    intervalCount,
    scheduleHour,
    scheduleMinute,
    nowInUserTz,
    dowValues,
    cronExpression,
    timezone,
  });

  return {
    cronExpression,
    nextExecution,
    interval,
    intervalCount,
    scheduleHour,
    scheduleMinute,
    timezone,
    dow: dowValues,
  };
}

type NextExecutionInput = {
  interval: string;
  intervalCount: number;
  scheduleHour: number;
  scheduleMinute: number;
  nowInUserTz: Date;
  dowValues?: string[];
  cronExpression: string;
  timezone: string;
};

function resolveNextExecution(input: NextExecutionInput): Date {
  const {
    interval,
    intervalCount,
    scheduleHour,
    scheduleMinute,
    nowInUserTz,
    dowValues,
    cronExpression,
    timezone,
  } = input;

  if (interval === "cron") {
    const cron = CronExpressionParser.parse(cronExpression, { tz: timezone });
    return cron.next().toDate();
  }

  const nextExecution = new Date(nowInUserTz);

  switch (interval) {
    case "Minutes":
      nextExecution.setMinutes(nowInUserTz.getMinutes() + intervalCount);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      break;
    case "Hours":
      nextExecution.setHours(nowInUserTz.getHours() + intervalCount);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      break;
    case "Days":
      nextExecution.setDate(nowInUserTz.getDate() + intervalCount);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      break;
    case "Weeks": {
      const selectedDays = (dowValues || [])
        .map((d) => Number.parseInt(d, 10))
        .sort((a, b) => a - b);
      const currentDayOfWeek = nowInUserTz.getDay();

      let minDaysUntilTarget = Number.POSITIVE_INFINITY;

      for (const targetDayOfWeek of selectedDays) {
        let daysUntilTarget = targetDayOfWeek - currentDayOfWeek;

        if (daysUntilTarget < 0) {
          daysUntilTarget += 7;
        } else if (daysUntilTarget === 0) {
          const targetTime = new Date(nowInUserTz);
          targetTime.setHours(scheduleHour, scheduleMinute, 0, 0);

          if (nowInUserTz >= targetTime) {
            daysUntilTarget = 7;
          }
        }

        if (daysUntilTarget < minDaysUntilTarget) {
          minDaysUntilTarget = daysUntilTarget;
        }
      }

      if (intervalCount > 1) {
        minDaysUntilTarget += (intervalCount - 1) * 7;
      }

      nextExecution.setDate(nowInUserTz.getDate() + minDaysUntilTarget);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      nextExecution.setSeconds(0);
      nextExecution.setMilliseconds(0);
      break;
    }
    case "Months":
      nextExecution.setMonth(nowInUserTz.getMonth() + intervalCount);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      break;
    default:
      throw createError(`Invalid interval type: ${interval}`, 400);
  }

  return nextExecution;
}

function buildCronExpression(
  interval: string,
  intervalCount: number,
  scheduleHour: number,
  scheduleMinute: number,
  dowValues?: string[],
  cronInput?: string
): string {
  if (interval === "cron") {
    if (!cronInput) {
      throw createError("cron expression is required", 400);
    }
    return cronInput;
  }

  switch (interval) {
    case "Minutes":
      return `*/${intervalCount} * * * *`;
    case "Hours":
      return `${scheduleMinute} */${intervalCount} * * *`;
    case "Days":
      return `${scheduleMinute} ${scheduleHour} */${intervalCount} * *`;
    case "Weeks": {
      const cronDays = (dowValues || []).join(",");
      return `${scheduleMinute} ${scheduleHour} * * ${cronDays}`;
    }
    case "Months":
      return `${scheduleMinute} ${scheduleHour} 1 */${intervalCount} *`;
    default:
      throw createError(`Invalid interval type: ${interval}`, 400);
  }
}

function resolveNumber(
  value: string | number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return clampInt(value, fallback, min, max);
}

function clampInt(
  value: string | number | undefined,
  fallback: number,
  min: number,
  max: number
) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(parsed)) {
    return Math.min(max, Math.max(min, parsed));
  }
  return fallback;
}
