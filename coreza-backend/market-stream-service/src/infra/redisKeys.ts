export const RedisKeys = {
  strategyStream: (userId: string, workflowId: string): string =>
    `userId:${userId}:workflowId:${workflowId}:strategy:stream`,
};
