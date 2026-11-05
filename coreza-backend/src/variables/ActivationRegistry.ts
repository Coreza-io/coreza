import type Redis from "ioredis";
import { createActivationRegistryConnection } from "../config/redis";

// A bounded queue-Redis transport for single-use activation markers; no values or checkpoints.
const clients: Array<{ client?: Redis; busy: boolean }> = Array.from({ length: 4 }, () => ({ busy: false }));
export function closeActivationConnections(): void {
  if (clients.some(slot => slot.busy)) throw new Error("Activation registry tasks have not drained");
  for (const slot of clients) { slot.client?.disconnect(); slot.client = undefined; }
}
export async function withActivationRedis<T>(operation: (client: Redis) => Promise<T>): Promise<T> {
  const slot = clients.find(slot => !slot.busy);
  if (!slot) throw new Error("Activation registry busy");
  slot.busy = true;
  try {
    slot.client ??= createActivationRegistryConnection();
    if (slot.client.status === "wait") await slot.client.connect();
    if (slot.client.status !== "ready") throw new Error("Activation registry unavailable");
    return await operation(slot.client);
  } catch (error) {
    slot.client?.disconnect(); slot.client = undefined;
    throw error;
  } finally { slot.busy = false; }
}
