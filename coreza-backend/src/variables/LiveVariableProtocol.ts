import { createHash } from "crypto";
import type Redis from "ioredis";
import { createLiveVariableConnection } from "../config/redis";
import { supabase } from "../config/supabase";
import { RedisKeys } from "../infra/redisKeys";
import { freezeVariableSnapshot, type VariableSnapshot } from "./contract";
import { LiveVariableSafetyStop } from "./LiveVariableState";
import { liveVariableOperations, liveVariableLatency, liveVariablePayload, liveVariableResources } from "../utils/metrics";

export const LIVE_BUCKETS = 16;
export const LIVE_PAYLOAD_BYTES = 262144;
export interface LiveVersion { epoch: string; fence: string; generation: string; hash: string }
export interface LiveCheckpoint {
  schemaVersion: 1;
  epoch: string;
  fence: string;
  generation: string;
  parent: LiveVersion | null;
  capturedAt: number;
  snapshot: VariableSnapshot;
  source: { event: string; outcome: "success" | "failed" | "cancelled" };
}
export interface EncodedCheckpoint { checkpoint: LiveCheckpoint; payload: string; hash: string }
export const liveDecimal = (value: unknown): value is string => typeof value === "string" && value.length <= 19 && /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function encodeCheckpoint(checkpoint: LiveCheckpoint): EncodedCheckpoint {
  const payload = JSON.stringify({ ...checkpoint, snapshot: { ...checkpoint.snapshot, values: undefined } });
  if (Buffer.byteLength(payload) > LIVE_PAYLOAD_BYTES) throw new Error("Live checkpoint envelope limit exceeded");
  return { checkpoint, payload, hash: createHash("sha256").update(payload).digest("hex") };
}
export function decodeCheckpoint(payload: string, hash: string, owner: string, workflow: string): EncodedCheckpoint {
  if (Buffer.byteLength(payload) > LIVE_PAYLOAD_BYTES || createHash("sha256").update(payload).digest("hex") !== hash) throw new Error("Invalid live checkpoint hash/size");
  const raw = JSON.parse(payload);
  if (raw.schemaVersion !== 1 || !uuid(raw.epoch) || !liveDecimal(raw.fence) || !liveDecimal(raw.generation) || !Number.isFinite(raw.capturedAt) || raw.capturedAt < 0 ||
      !raw.source || typeof raw.source.event !== "string" || raw.source.event.length > 256 || !["success", "failed", "cancelled"].includes(raw.source.outcome) ||
      (raw.parent !== null && (!raw.parent || !uuid(raw.parent.epoch) || !liveDecimal(raw.parent.fence) || !liveDecimal(raw.parent.generation) || !/^[a-f0-9]{64}$/.test(raw.parent.hash)))) throw new Error("Invalid live checkpoint version/coverage");
  const snapshot = freezeVariableSnapshot(raw.snapshot, owner, workflow);
  return { checkpoint: { ...raw, snapshot }, payload, hash };
}
export function decodeLiveRecord(record: Record<string, string>, owner: string, workflow: string): EncodedCheckpoint {
  const encoded = decodeCheckpoint(record.payload, record.hash, owner, workflow);
  const e = encoded.checkpoint;
  if (record.owner !== owner || record.workflow !== workflow || record.epoch !== e.epoch || record.fence !== e.fence || record.generation !== e.generation)
    throw new LiveVariableSafetyStop("Live checkpoint header/envelope mismatch");
  if (record.sqlGeneration !== undefined && (!liveDecimal(record.sqlGeneration) || !/^[a-f0-9]{64}$/.test(record.sqlHash ?? "") || !Number.isFinite(Number(record.sqlCapturedAt))))
    throw new LiveVariableSafetyStop("Live checkpoint SQL progress invalid");
  return encoded;
}
export function version(encoded: EncodedCheckpoint): LiveVersion {
  const { epoch, fence, generation } = encoded.checkpoint;
  return { epoch, fence, generation, hash: encoded.hash };
}
export function sameVersion(a: LiveVersion | null, b: LiveVersion): boolean {
  return !!a && a.epoch === b.epoch && a.fence === b.fence && a.generation === b.generation && a.hash === b.hash;
}
export function liveKeys(owner: string, workflow: string) {
  const member = createHash("sha256").update(JSON.stringify([owner, workflow])).digest("hex");
  return RedisKeys.liveVariableScope(parseInt(member.slice(0, 2), 16) % LIVE_BUCKETS, member);
}

// Decimal comparisons intentionally never use Lua doubles for fences/generations.
const SCRIPT = `
local function cmp(a,b) if #a ~= #b then return #a > #b and 1 or -1 end if a==b then return 0 end return a>b and 1 or -1 end
local function typ(k,want) local t=redis.call('TYPE',k).ok if t~='none' and t~=want then error('live-variable-key-type') end end
typ(KEYS[1],'string') typ(KEYS[2],'hash') typ(KEYS[3],'set')
local op=ARGV[1] local owner=ARGV[2] local workflow=ARGV[3] local fence=ARGV[4] local epoch=ARGV[5]
local raw=redis.call('GET',KEYS[1]) local a=raw and cjson.decode(raw) or nil
if a and (a.owner~=owner or a.workflow~=workflow) then error('live-variable-scope') end
local t=redis.call('TIME') local now=t[1]*1000+math.floor(t[2]/1000)
local function save() redis.call('SET',KEYS[1],cjson.encode(a)) end
local lease=tonumber(ARGV[6] or '0')
if (op=='seal' or op=='renew') and (not lease or lease<0 or lease>now+15000) then error('live-variable-lease') end
if op=='seal' then
  if a and cmp(fence,a.fence)<0 then error('live-variable-stale-fence') end
  a={owner=owner,workflow=workflow,fence=fence,epoch=epoch,phase='recovering',lease=lease} save()
  return redis.call('HGETALL',KEYS[2])
end
if not a or a.fence~=fence or a.epoch~=epoch then error('live-variable-authority') end
if op=='renew' then
  if a.phase~='active' then error('live-variable-sealed') end
  if lease<=now then error('live-variable-lease') end
  a.lease=math.max(a.lease,lease) save() return 'ok'
end
if op=='read' then return redis.call('HGETALL',KEYS[2]) end
if op=='init' or op=='publish' then
  if now>=a.lease or (op=='publish' and a.phase~='active') or (op=='init' and a.phase~='recovering' and a.phase~='active') then error('live-variable-lease') end
  local payload=ARGV[7] local hash=ARGV[8] local gen=ARGV[9]
  if #payload>262144 or #hash~=64 then error('live-variable-payload') end
  local e=cjson.decode(payload)
  if e.schemaVersion~=1 or e.epoch~=epoch or e.fence~=fence or e.generation~=gen or e.snapshot.owner~=owner or e.snapshot.workflowId~=workflow or #e.snapshot.entries>128 then error('live-variable-envelope') end
  local oldEpoch=redis.call('HGET',KEYS[2],'epoch') local oldGen=redis.call('HGET',KEYS[2],'generation')
  if oldEpoch==epoch then
    local order=cmp(gen,oldGen)
    if order<0 then error('live-variable-stale-generation') end
    if order==0 and redis.call('HGET',KEYS[2],'hash')~=hash then error('live-variable-hash-conflict') end
  elseif op~='init' then error('live-variable-epoch') end
  -- Preflight first; mark dirty before replacement so partial failures stay dirty.
  redis.call('SADD',KEYS[3],ARGV[10])
  if oldEpoch~=epoch then redis.call('HDEL',KEYS[2],'sqlGeneration','sqlHash','sqlCapturedAt') end
  redis.call('HSET',KEYS[2],'owner',owner,'workflow',workflow,'epoch',epoch,'fence',fence,'generation',gen,'hash',hash,'payload',payload)
  if op=='init' then a.phase='active' save() end
  return redis.call('HGETALL',KEYS[2])
end
if op=='ack' then
  -- A stale worker may acknowledge only its captured producer, never a child.
  if redis.call('HGET',KEYS[2],'epoch')~=ARGV[7] or redis.call('HGET',KEYS[2],'fence')~=ARGV[8] then return 'stale' end
  local gen=ARGV[9] local old=redis.call('HGET',KEYS[2],'sqlGeneration') or '0'
  if gen==old and redis.call('HGET',KEYS[2],'sqlHash') and redis.call('HGET',KEYS[2],'sqlHash')~=ARGV[11] then error('live-variable-sql-hash-conflict') end
  if cmp(gen,old)>=0 then redis.call('HSET',KEYS[2],'sqlGeneration',gen,'sqlHash',ARGV[11],'sqlCapturedAt',ARGV[12]) end
  if redis.call('HGET',KEYS[2],'generation')==gen and redis.call('HGET',KEYS[2],'hash')==ARGV[11] then redis.call('SREM',KEYS[3],ARGV[10]) end
  return 'ok'
end
error('live-variable-operation')`;

// Fixed client/task/byte caps. No wait queue: callers retry at their cadence.
const clients: Array<{ client?: Redis; busy: boolean }> = Array.from({ length: 4 }, () => ({ busy: false }));
export function closeLiveVariableConnections(): void {
  if (clients.some(s => s.busy)) throw new Error("Live checkpoint tasks have not drained");
  for (const slot of clients) { slot.client?.disconnect(); slot.client = undefined; }
  liveVariableResources.set({ kind: "connections" }, 0);
}
export async function withLiveRedis<T>(operation: (client: Redis) => Promise<T>, operationName = "redis_auxiliary"): Promise<T> {
  const started = performance.now();
  const slot = clients.find(s => !s.busy);
  if (!slot) { liveVariableOperations.inc({ operation: operationName, status: "error" }); throw new Error("Live checkpoint transport busy"); }
  slot.busy = true;
  liveVariableResources.set({ kind: "redis_tasks" }, clients.filter(s => s.busy).length);
  try {
    slot.client ??= createLiveVariableConnection();
    if (slot.client.status === "wait") await slot.client.connect();
    if (slot.client.status !== "ready") throw new Error("Live checkpoint transport unavailable");
    const result = await operation(slot.client);
    liveVariableOperations.inc({ operation: operationName, status: "success" });
    return result;
  } catch (error) {
    // A command timeout is ambiguous, not cancellation. Retire this connection;
    // the caller retains its exact version/hash and reconciles by idempotent CAS.
    slot.client?.disconnect(); slot.client = undefined;
    liveVariableOperations.inc({ operation: operationName, status: "error" });
    throw error;
  } finally {
    slot.busy = false;
    liveVariableResources.set({ kind: "redis_tasks" }, clients.filter(s => s.busy).length);
    liveVariableResources.set({ kind: "connections" }, clients.filter(s => s.client).length);
    liveVariableLatency.observe({ operation: operationName }, (performance.now() - started) / 1000);
  }
}
export async function liveRedisClock(): Promise<{ time: number; receivedAt: number }> {
  const raw = await withLiveRedis(redis => redis.time(), "redis_clock");
  const receivedAt = performance.now();
  const time = Number(raw[0]) * 1000 + Math.floor(Number(raw[1]) / 1000);
  if (!Number.isSafeInteger(time) || time < 0) throw new Error("Invalid Redis lease clock");
  return { time, receivedAt };
}
export function redisLeaseDeadline(localDeadline: number, clock: { time: number; receivedAt: number }): string {
  // Receipt time is the conservative side of the Redis TIME round trip. Passing
  // an absolute deadline prevents a delayed/retried command minting a new lease.
  return String(Math.max(0, Math.floor(clock.time + localDeadline - clock.receivedAt)));
}
export async function liveCommand(owner: string, workflow: string, fence: string, epoch: string, operation: string, extra: string[] = []) {
  const keys = liveKeys(owner, workflow);
  if (operation === "publish" || operation === "init") liveVariablePayload.inc({ transport: "redis" }, Buffer.byteLength(extra[1]));
  return withLiveRedis(redis => redis.eval(SCRIPT, 3, keys.authority, keys.checkpoint, keys.dirty, operation, owner, workflow, fence, epoch, ...extra), `redis_${operation}`);
}
export function fields(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw) || raw.length % 2 !== 0 || raw.length > 32) throw new Error("Invalid checkpoint receipt");
  const result: Record<string, string> = Object.create(null);
  for (let i = 0; i < raw.length; i += 2) result[String(raw[i])] = String(raw[i + 1]);
  return result;
}
let sqlTasks = 0;
export async function liveRPC(operation: string, owner: string, workflow: string, args: Record<string, unknown> = {}): Promise<any> {
  const started = performance.now();
  if (sqlTasks >= 4) {
    liveVariableOperations.inc({ operation: `sql_${operation}`, status: "error" });
    throw Object.assign(new Error("Live variable SQL transport busy"), { liveBusy: true });
  }
  sqlTasks++;
  liveVariableResources.set({ kind: "sql_tasks" }, sqlTasks);
  if (typeof args.payload === "string") liveVariablePayload.inc({ transport: "sql" }, Buffer.byteLength(args.payload));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const { data, error } = await (supabase.rpc as any)("workflow_live_variables", { p_operation: operation, p_owner: owner, p_workflow: workflow, p_args: args }).abortSignal(controller.signal);
    if (error && /^live-variable-(stale-authority|not-active|lease-expired|ineligible|workflow-denied)\b/.test(error.message ?? "")) throw new LiveVariableSafetyStop("Live variable SQL admission revoked; recovery required");
    if (error || data === null) throw new Error(`Live variable ${operation} rejected`);
    liveVariableOperations.inc({ operation: `sql_${operation}`, status: "success" });
    return data;
  } catch (error) { liveVariableOperations.inc({ operation: `sql_${operation}`, status: "error" }); throw error; }
  finally {
    clearTimeout(timer); sqlTasks--;
    liveVariableResources.set({ kind: "sql_tasks" }, sqlTasks);
    liveVariableLatency.observe({ operation: `sql_${operation}` }, (performance.now() - started) / 1000);
  }
}
