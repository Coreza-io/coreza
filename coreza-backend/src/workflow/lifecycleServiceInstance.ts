import { BacktestLifecycleAdapter } from "../backtest";
import { WorkflowLifecycleService } from "./WorkflowLifecycleService";
import { WorkflowRepository } from "./WorkflowRepository";
import { WorkflowRunRepository } from "./WorkflowRunRepository";
import { SchedulerLifecycleAdapter } from "./SchedulerLifecycleAdapter";
import { StreamingLifecycleAdapter } from "./StreamingLifecycleAdapter";

export function createWorkflowLifecycleService(): WorkflowLifecycleService {
  return new WorkflowLifecycleService(
    new WorkflowRepository(),
    new WorkflowRunRepository(),
    new StreamingLifecycleAdapter(),
    new SchedulerLifecycleAdapter(),
    new BacktestLifecycleAdapter(),
  );
}
