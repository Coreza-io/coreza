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

import { ISchedulerService, SchedulerBackend } from "./types";
import { InProcessScheduler } from "./InProcessScheduler";
import { BullMQScheduler } from "./BullMQScheduler";

let schedulerInstance: ISchedulerService | null = null;

/**
 * Get the configured scheduler backend from environment
 * 
 * SCHEDULER_BACKEND environment variable:
 * - "in-process" (default): Uses node-schedule, in-memory timers
 * - "bullmq": Uses BullMQ repeatable jobs, Redis-backed
 */
export function getSchedulerBackend(): SchedulerBackend {
  const backend = process.env.SCHEDULER_BACKEND?.toLowerCase();
  return backend === "bullmq" ? "bullmq" : "in-process";
}

/**
 * Get or create the scheduler instance
 * 
 * Uses singleton pattern to ensure only one scheduler is active.
 * The scheduler type is determined by SCHEDULER_BACKEND env var.
 */
export function getScheduler(): ISchedulerService {
  if (!schedulerInstance) {
    const backend = getSchedulerBackend();

    if (backend === "bullmq") {
      console.log("📅 [SCHEDULER] Using BullMQ-based scheduler (durable, multi-instance safe)");
      schedulerInstance = new BullMQScheduler();
    } else {
      console.log("📅 [SCHEDULER] Using in-process scheduler (node-schedule, single-instance)");
      schedulerInstance = new InProcessScheduler();
    }
  }
  return schedulerInstance;
}

/**
 * Reset the scheduler instance (for testing)
 */
export function resetScheduler(): void {
  schedulerInstance = null;
}

// Re-export types and implementations
export { ISchedulerService, SchedulerBackend, ScheduleInfo, ScheduleOptions } from "./types";
export { InProcessScheduler } from "./InProcessScheduler";
export { BullMQScheduler } from "./BullMQScheduler";

// Backward compatibility: export workflowScheduler singleton
// This allows gradual migration from direct import
export const workflowScheduler = getScheduler();
