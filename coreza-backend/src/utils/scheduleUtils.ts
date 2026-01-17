/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import CronExpressionParser from "cron-parser";
import { toZonedTime } from "date-fns-tz";
import { createError, type AppError } from "../middleware/errorHandler";

export type SchedulerInput = {
  interval?: string;
  mode?: string;
  count?: string | number;
  minute?: string | number;
  hour?: string | number;
  dom?: string | number;
  dow?: Array<string | number>;
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
  const interval = normalizeInterval(input);
  const nowInUserTz = toZonedTime(new Date(), timezone);

  const intervalCount = clampInt(input.count, 1, 1, 10000);
  const scheduleHour = resolveNumber(
    input.hour,
    nowInUserTz.getHours(),
    0,
    23
  );
  const scheduleMinute = resolveNumber(
    input.minute,
    nowInUserTz.getMinutes(),
    0,
    59
  );

  let dowValues: string[] | undefined;
  if (interval === "weeks") {
    if (!input.dow || !Array.isArray(input.dow) || input.dow.length === 0) {
      throw createError(
        'dow (days of week) is required for weekly intervals as an array (e.g., ["1", "5"] for Monday and Friday)',
        400
      );
    }

    dowValues = input.dow.map((day) => {
      const dayNum = Number.parseInt(String(day), 10);
      if (Number.isNaN(dayNum) || dayNum < 0 || dayNum > 6) {
        const error = createError(
          "Each day in dow must be between 0 (Sunday) and 6 (Saturday)",
          400
        ) as AppError & { details?: Record<string, unknown> };
        error.details = { invalidDay: day };
        throw error;
      }
      return String(dayNum);
    });
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
    case "minutes":
      nextExecution.setMinutes(nowInUserTz.getMinutes() + intervalCount);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      break;
    case "hours":
      nextExecution.setHours(nowInUserTz.getHours() + intervalCount);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      break;
    case "days":
      nextExecution.setDate(nowInUserTz.getDate() + intervalCount);
      nextExecution.setHours(scheduleHour);
      nextExecution.setMinutes(scheduleMinute);
      break;
    case "weeks": {
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
    case "months":
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
    case "minutes":
      return `*/${intervalCount} * * * *`;
    case "hours":
      return `${scheduleMinute} */${intervalCount} * * *`;
    case "days":
      return `${scheduleMinute} ${scheduleHour} */${intervalCount} * *`;
    case "weeks": {
      const cronDays = (dowValues || []).join(",");
      return `${scheduleMinute} ${scheduleHour} * * ${cronDays}`;
    }
    case "months":
      return `${scheduleMinute} ${scheduleHour} 1 */${intervalCount} *`;
    default:
      throw createError(`Invalid interval type: ${interval}`, 400);
  }
}

function normalizeInterval(input: SchedulerInput): string {
  const rawInterval = (input.interval ?? "").toString().toLowerCase();
  if (rawInterval) {
    return normalizeIntervalAlias(rawInterval);
  }
  const rawMode = (input.mode ?? "").toString().toLowerCase();
  if (rawMode) {
    return normalizeIntervalAlias(rawMode);
  }
  return "minutes";
}

function normalizeIntervalAlias(value: string): string {
  if (value === "daily") return "days";
  if (value === "weekly") return "weeks";
  if (value === "monthly") return "months";
  if (value === "cron") return "cron";
  return value;
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
