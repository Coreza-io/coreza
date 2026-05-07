export const RedisKeys = {
  strategyStream: (userId: string, workflowId: string): string =>
    `strategy:userId:${userId}:workflowId:${workflowId}:stream`,
};
