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

/**
 * Scheduler Types and Interfaces
 * 
 * Defines the contract for workflow scheduling implementations.
 * Supports both in-process (node-schedule) and BullMQ-based scheduling.
 */

export interface ScheduleInfo {
  workflowId: string;
  userId: string;
  cronExpression: string;
  timezone?: string;
  nextRun?: Date;
  jobId?: string; // BullMQ job ID for tracking
}

export interface ScheduleOptions {
  timezone?: string;
  start?: string | Date | null;
}

export interface ISchedulerService {
  /** Scheduler type identifier */
  readonly type: 'in-process' | 'bullmq';

  /** Initialize scheduler (load schedules from DB if needed) */
  initialize(): Promise<void>;

  /** Schedule a workflow for execution */
  scheduleWorkflow(
    workflowId: string,
    userId: string,
    cronExpression: string,
    nodes: any[],
    edges: any[],
    options?: ScheduleOptions
  ): Promise<void>;

  /** Unschedule a workflow */
  unscheduleWorkflow(workflowId: string): Promise<void>;

  /** Update workflow schedule */
  updateWorkflowSchedule(
    workflowId: string,
    userId: string,
    cronExpression: string | null,
    nodes: any[],
    edges: any[],
    timezone?: string
  ): Promise<void>;

  /** Get all scheduled jobs */
  getScheduledJobs(): ScheduleInfo[];

  /** Get next run date for a specific workflow */
  getNextRunDate(workflowId: string): Date | undefined;

  /** Shutdown scheduler */
  shutdown(): Promise<void>;
}

/**
 * Scheduler backend type
 */
export type SchedulerBackend = 'in-process' | 'bullmq';
