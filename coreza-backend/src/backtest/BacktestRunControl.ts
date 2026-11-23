import type Redis from "ioredis";
import { createBoundedQueueRedisConnection } from "../config/redis";
import { supabase } from "../config/supabase";
import { RedisKeys } from "../infra/redisKeys";
import { createError } from "../middleware/errorHandler";
import logger from "../utils/logger";

export const BACKTEST_LEASE_SECONDS = 90;
const CANCEL_POLL_MS = 2_000;
const LEASE_RENEW_MS = 10_000;

const activations = new Set<Promise<unknown>>();
const controllers = new Map<string, AbortController>();
let draining = false;
let leaseRedis: Redis | undefined;
let connectingRedis: Promise<Redis> | undefined;

async function getLeaseRedis(): Promise<Redis> {
  if (leaseRedis?.status === "ready") return leaseRedis;
  if (!connectingRedis) {
    leaseRedis?.disconnect();
    const redis = createBoundedQueueRedisConnection();
    connectingRedis = redis.connect().then(() => {
      leaseRedis = redis;
      return redis;
    }, (error: unknown) => {
      redis.disconnect();
      throw error;
    }).finally(() => { connectingRedis = undefined; });
  }
  return connectingRedis;
}


export function trackBacktestActivation<T>(activate: () => Promise<T>): Promise<T> {
  if (draining) return Promise.reject(createError("Backend is shutting down", 503));
  const activation = activate();
  activations.add(activation);
  return activation.finally(() => activations.delete(activation));
}

export async function drainBacktestActivations(): Promise<void> {
  draining = true;
  for (const controller of controllers.values()) controller.abort(new Error("Backtest stopped during backend shutdown"));
  await Promise.allSettled(activations);
}

export function signalBacktestCancellation(runId: string): void {
  controllers.get(runId)?.abort(new Error("Workflow cancelled by user"));
}

export async function hasBacktestLease(runId: string): Promise<boolean> {
  return (await (await getLeaseRedis()).exists(RedisKeys.backtestLease(runId))) === 1;
}

export async function runWithBacktestLease<T>(
  runId: string,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  controllers.set(runId, controller);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> | undefined;
  let finished = false;
  try {
    const key = RedisKeys.backtestLease(runId);
    const acquired = await (await getLeaseRedis()).set(key, "running", "EX", BACKTEST_LEASE_SECONDS, "NX");
    if (!acquired) throw new Error("Backtest run already has an execution lease");
    let lastRenewal = performance.now();

    const poll = async () => {
      try {
        if (performance.now() - lastRenewal >= LEASE_RENEW_MS) {
          try {
            const renewed = await (await getLeaseRedis()).expire(key, BACKTEST_LEASE_SECONDS);
            if (!renewed) controller.abort(new Error("Backtest execution lease expired"));
            else lastRenewal = performance.now();
          } catch (error) {
            if (performance.now() - lastRenewal >= (BACKTEST_LEASE_SECONDS - 10) * 1000) {
              controller.abort(new Error("Backtest execution lease could not be renewed"));
            }
            logger.warn({ err: error, runId }, "Could not renew backtest lease");
          }
        }
        if (!controller.signal.aborted) {
          const { data, error } = await supabase.schema("public").from("workflow_runs").select("status")
            .eq("id", runId).abortSignal(AbortSignal.timeout(CANCEL_POLL_MS)).maybeSingle();
          if (error) throw new Error(error.message);
          if (data?.status === "cancelling") signalBacktestCancellation(runId);
          else if (!data || !["queued", "running"].includes(data.status)) {
            controller.abort(new Error("Backtest parent is no longer active"));
          }
        }
      } catch (error) {
        logger.warn({ err: error, runId }, "Could not check active backtest");
      } finally {
        if (!finished) timer = setTimeout(() => { polling = poll(); }, CANCEL_POLL_MS);
      }
    };

    if (draining) controller.abort(new Error("Backtest stopped during backend shutdown"));
    timer = setTimeout(() => { polling = poll(); }, CANCEL_POLL_MS);
    return await execute(controller.signal);
  } finally {
    finished = true;
    clearTimeout(timer);
    await polling;
    controllers.delete(runId);
    // The lease expires on its own, covering the parent status write and activation release.
  }
}
