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

import express from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { toZonedTime, formatInTimeZone } from "date-fns-tz";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// Scheduler execution handler
router.post("/scheduler", async (req, res) => {
  try {
    const { interval, count, hour, minute, timezone, dow } = req.body;

    if (!interval || !count) {
      return res.status(400).json({
        error: "Interval and count are required",
        received: { interval, count, hour, minute, dow },
      });
    }

    // Validate dow for weekly intervals
    if (interval.toLowerCase() === "weeks") {
      if (!dow || !Array.isArray(dow) || dow.length === 0) {
        return res.status(400).json({
          error:
            'dow (days of week) is required for weekly intervals as an array (e.g., ["1", "5"] for Monday and Friday)',
          received: { dow },
        });
      }

      // Validate each day is between 0-6
      for (const day of dow) {
        const dayNum = parseInt(day);
        if (isNaN(dayNum) || dayNum < 0 || dayNum > 6) {
          return res.status(400).json({
            error:
              "Each day in dow must be between 0 (Sunday) and 6 (Saturday)",
            received: { dow, invalidDay: day },
          });
        }
      }
    }

    // Calculate next execution time based on the schedule
    // Get current time in user's selected timezone
    const userTimezone = timezone || "UTC";
    const nowInUserTz = toZonedTime(new Date(), userTimezone);
    const nextExecution = new Date(nowInUserTz);

    // Parse the scheduling parameters
    const intervalCount = parseInt(count);
    const scheduleHour = hour ? parseInt(hour) : nowInUserTz.getHours();
    const scheduleMinute = minute ? parseInt(minute) : nowInUserTz.getMinutes();

    switch (interval.toLowerCase()) {
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
      case "weeks":
        // Parse all selected days of week
        const selectedDays = dow
          .map((d: string) => parseInt(d))
          .sort((a: number, b: number) => a - b);
        const currentDayOfWeek = nowInUserTz.getDay();

        // Find the next occurrence among all selected days
        let minDaysUntilTarget = Infinity;

        for (const targetDayOfWeek of selectedDays) {
          let daysUntilTarget = targetDayOfWeek - currentDayOfWeek;

          // If target day has passed this week, go to next occurrence
          if (daysUntilTarget < 0) {
            daysUntilTarget += 7;
          } else if (daysUntilTarget === 0) {
            // If it's the target day today, check if the time has passed
            const targetTime = new Date(nowInUserTz);
            targetTime.setHours(scheduleHour, scheduleMinute, 0, 0);

            if (nowInUserTz >= targetTime) {
              // Time has passed, schedule for next week
              daysUntilTarget = 7;
            }
          }

          // Find the minimum (soonest occurrence)
          if (daysUntilTarget < minDaysUntilTarget) {
            minDaysUntilTarget = daysUntilTarget;
          }
        }

        // Add additional weeks if interval > 1
        if (intervalCount > 1) {
          minDaysUntilTarget += (intervalCount - 1) * 7;
        }

        nextExecution.setDate(nowInUserTz.getDate() + minDaysUntilTarget);
        nextExecution.setHours(scheduleHour);
        nextExecution.setMinutes(scheduleMinute);
        nextExecution.setSeconds(0);
        nextExecution.setMilliseconds(0);
        break;
      case "months":
        nextExecution.setMonth(nowInUserTz.getMonth() + intervalCount);
        nextExecution.setHours(scheduleHour);
        nextExecution.setMinutes(scheduleMinute);
        break;
      default:
        return res.status(400).json({ error: "Invalid interval type" });
    }

    // Generate cron expression for the schedule
    let cronExpression = "";
    switch (interval.toLowerCase()) {
      case "minutes":
        cronExpression = `*/${intervalCount} * * * *`;
        break;
      case "hours":
        cronExpression = `${scheduleMinute} */${intervalCount} * * *`;
        break;
      case "days":
        cronExpression = `${scheduleMinute} ${scheduleHour} */${intervalCount} * *`;
        break;
      case "weeks":
        // Parse and join days with comma for cron (supports multiple days)
        const cronDays = dow.map((d: string) => parseInt(d)).join(",");

        if (intervalCount === 1) {
          // Every week on selected days: "0 10 * * 1,5" (Mon, Fri)
          cronExpression = `${scheduleMinute} ${scheduleHour} * * ${cronDays}`;
        } else {
          // Note: Cron cannot natively express "every N weeks", so this runs every week
          // The actual interval logic would need to be handled by node-schedule or custom logic
          cronExpression = `${scheduleMinute} ${scheduleHour} * * ${cronDays}`;
        }
        break;
      case "months":
        cronExpression = `${scheduleMinute} ${scheduleHour} 1 */${intervalCount} *`;
        break;
    }
    const nextExecutionFormatted = formatInTimeZone(
      nextExecution,
      userTimezone,
      "yyyy-MM-dd HH:mm"
    );

    res.json({
      message: "Scheduler triggered successfully",
      schedule: {
        interval,
        count: intervalCount,
        hour: scheduleHour,
        minute: scheduleMinute,
        dow: interval.toLowerCase() === "weeks" ? dow : undefined,
        timezone: userTimezone,
      },
      nextExecution: nextExecutionFormatted,
      cronExpression,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Scheduler error:", error);
    res.status(500).json({
      error: "Failed to process scheduler request",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
