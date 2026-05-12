import { getRedisCache } from "../../../config/redis";
import { REDIS_CHANNELS } from "../../../config/redisChannels";

export type RedisTriggerSubscriptionType = "channel" | "pattern";

export async function publishRedisTriggerSubscribe(params: {
  workflowId: string;
  nodeId: string;
  userId: string;
  channels: string[];
  subscriptionType: RedisTriggerSubscriptionType;
}): Promise<void> {
  const redis = getRedisCache();
  await redis.publish(
    REDIS_CHANNELS.controlRegister,
    JSON.stringify({
      action: "register_workflow",
      userId: params.userId,
      workflowId: params.workflowId,
      nodeId: params.nodeId,
      source: "redisTrigger",
      scope: params.channels,
      subscriptionType: params.subscriptionType,
    }),
  );
}

export async function publishRedisTriggerUnsubscribe(params: {
  workflowId: string;
  userId: string;
}): Promise<void> {
  const redis = getRedisCache();
  await redis.publish(
    REDIS_CHANNELS.controlUnregister,
    JSON.stringify({
      action: "unregister_workflow",
      userId: params.userId,
      workflowId: params.workflowId,
      source: "redisTrigger",
    }),
  );
}
