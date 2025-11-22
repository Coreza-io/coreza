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
