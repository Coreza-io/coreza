import { formatInTimeZone } from "date-fns-tz";
import { bullMqJobQueue as jobQueue } from "../services/jobQueueManager";

export class SchedulerLifecycleAdapter {
  async schedule(
    workflowId: string,
    userId: string,
    cron: string,
    timezone: string,
  ): Promise<void> {
    await jobQueue.scheduleWorkflow(workflowId, userId, cron, timezone);
  }

  async unschedule(workflowId: string): Promise<void> {
    await jobQueue.unscheduleWorkflow(workflowId);
  }

  async cancelJobs(userId: string, workflowId: string): Promise<number> {
    return jobQueue.cancelWorkflowJobs(userId, workflowId);
  }

  async getScheduledJobs() {
    const jobs = await jobQueue.getScheduledJobs();

    return jobs.map((job) => ({
      workflow_id: job.id?.startsWith("schedule:")
        ? job.id.replace("schedule:", "")
        : job.id,
      cron_expression: job.pattern,
      timezone: job.timezone || "UTC",
      next_run: job.next
        ? formatInTimeZone(
            job.next,
            job.timezone || "UTC",
            "yyyy-MM-dd HH:mm:ssXXX",
          )
        : null,
    }));
  }
}
