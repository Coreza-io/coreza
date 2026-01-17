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
import { formatInTimeZone } from "date-fns-tz";
import { calculateSchedule } from "../utils/scheduleUtils";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// Scheduler execution handler
router.post("/scheduler", async (req, res) => {
  const { interval, count, hour, minute, timezone, dow } = req.body;
  try {
    if (!interval || !count) {
      return res.status(400).json({
        error: "Interval and count are required",
        received: { interval, count, hour, minute, dow },
      });
    }

    const scheduleResult = calculateSchedule({
      interval,
      count,
      hour,
      minute,
      timezone,
      dow,
    });

    const nextExecutionFormatted = formatInTimeZone(
      scheduleResult.nextExecution,
      scheduleResult.timezone,
      "yyyy-MM-dd HH:mm"
    );

    res.json({
      message: "Scheduler triggered successfully",
      schedule: {
        interval: scheduleResult.interval,
        count: scheduleResult.intervalCount,
        hour: scheduleResult.scheduleHour,
        minute: scheduleResult.scheduleMinute,
        dow: scheduleResult.interval === "weeks" ? scheduleResult.dow : undefined,
        timezone: scheduleResult.timezone,
      },
      nextExecution: nextExecutionFormatted,
      cronExpression: scheduleResult.cronExpression,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Scheduler error:", error);

    if (error && typeof error === "object" && "statusCode" in error) {
      const err = error as { statusCode?: number; message?: string; details?: any };
      const statusCode = err.statusCode || 500;
      if (statusCode === 400) {
        return res.status(400).json({
          error: err.message || "Invalid scheduler input",
          received: { interval, count, hour, minute, dow },
          ...(err.details ? err.details : {}),
        });
      }
    }

    res.status(500).json({
      error: "Failed to process scheduler request",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
