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

export interface WorkflowJobData {
  runId: string;
  workflowId: string;
  userId: string;
  nodes: any[];
  edges: any[];
  trigger?: "manual" | "scheduled" | "webhook" | "redis_pubsub" | "market_data";
  initialInput?: any;
  /** If true, skip all database logging for this run (high-frequency optimization) */
  useRedisStorage?: boolean;
}

export interface IWorkflowJobQueue {
  addWorkflowExecution(data: WorkflowJobData): Promise<any>;
  getQueueStats(): Promise<any>;
  cleanup(): Promise<void>;
}
