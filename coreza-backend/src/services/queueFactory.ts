import { inMemoryJobQueue } from "./inMemoryJobQueue";
import { IWorkflowJobQueue } from "./queueInterface";

export function createJobQueue(): IWorkflowJobQueue {
  const useBullMQ = process.env.USE_BULLMQ_QUEUE === "true";

  if (useBullMQ) {
    console.log("📦 [QUEUE] Using BullMQ with Redis for distributed job processing");
    const {
      bullMqJobQueue,
      BullMQJobQueue,
    }: { bullMqJobQueue: IWorkflowJobQueue; BullMQJobQueue: new () => IWorkflowJobQueue } = require("./jobQueueManager");
    return bullMqJobQueue ?? new BullMQJobQueue();
  }

  console.log("📦 [QUEUE] Using in-memory queue for local development");
  return inMemoryJobQueue;
}

export const jobQueue = createJobQueue();
