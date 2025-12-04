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

declare module "node-schedule" {
  export interface Job {
    cancel(reschedule?: boolean): void;
    nextInvocation(): Date | null;
  }

  export type JobRule = string | Date | { start?: string | Date; rule: string };
  export type JobCallback = (...args: any[]) => void | Promise<void>;

  export function scheduleJob(
    name: string,
    rule: JobRule,
    callback: JobCallback
  ): Job | null;

  export function scheduleJob(
    rule: JobRule,
    callback: JobCallback
  ): Job | null;
}
