import { createHash } from "crypto";
import { getRedisCache } from "../config/redis";
import { RedisKeys } from "../infra/redisKeys";
import { WorkflowRepository } from "../workflow/WorkflowRepository";
import { emptyVariableSnapshot, freezeVariableSnapshot, overlayVariables, type VariableChange, type VariableSnapshot } from "./contract";
import { EDITOR_VARIABLE_IDLE_SECONDS, parseEditorVariableScope, type EditorVariableScope } from "./editorScope";

// A single bounded record holds the snapshot and at most 128 receipts (256 KiB total).
// Close also writes when absent: it wins a race with the very first open.
const SCRIPT = `
local op = ARGV[1]
local raw = redis.call('GET', KEYS[1])
if op == 'close' then
  redis.call('SET', KEYS[1], '{"closed":true}', 'EX', ARGV[2])
  return 'closed'
end
local record = raw and cjson.decode(raw) or nil
if record and record.closed then return 'closed' end
if record and record.createdAt ~= tonumber(ARGV[7]) then return 'closed' end
if not record then
  if op ~= 'open' then return 'expired' end
  if ARGV[3] == 'expired' then return 'expired' end
  redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[2])
  return ARGV[3]
end
if op == 'prepare' then
  local receipt = record.receipts[ARGV[5]]
  if receipt then
    receipt = cjson.decode(receipt)
    if receipt.requestHash ~= ARGV[4] then return 'replay-conflict' end
    return receipt.base
  end
  if record.revision ~= ARGV[3] then return 'conflict' end
  return record.snapshot
end
if op == 'commit' then
  local token, hash = ARGV[5], ARGV[6]
  if record.receipts[token] then
    local receipt = cjson.decode(record.receipts[token])
    local submitted = cjson.decode(ARGV[8])
    if receipt.hash ~= hash or receipt.requestHash ~= submitted.requestHash then return 'replay-conflict' end
    redis.call('EXPIRE', KEYS[1], ARGV[2])
    return raw
  end
  if record.revision ~= ARGV[3] then return 'conflict' end
  -- Keep scalar JSON opaque: Lua cjson encoding rounds JS numbers to 14 digits.
  record.snapshot = ARGV[4]
  record.revision = cjson.decode(ARGV[4]).revision
  record.receipts[token] = ARGV[8]
  record.receiptBytes = record.receiptBytes + #ARGV[8]
  table.insert(record.order, token)
  while #record.order > 128 or record.receiptBytes > 262144 do
    local oldest = table.remove(record.order, 1)
    record.receiptBytes = record.receiptBytes - #record.receipts[oldest]
    record.receipts[oldest] = nil
  end
  raw = cjson.encode(record)
  redis.call('SET', KEYS[1], raw, 'EX', ARGV[2])
elseif op == 'touch' or op == 'open' then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return raw
`;
export class EditorVariableService {
  private readonly workflows = new WorkflowRepository();
  async authorize(owner: string, workflowId: unknown, rawScope: unknown) {
    const scope = parseEditorVariableScope(rawScope);
    if (typeof workflowId !== "string" || !/^[0-9a-f-]{36}$/i.test(workflowId))
      throw Object.assign(new Error("Save the workflow before using variables"), { statusCode: 400 });
    await this.workflows.getOwnedWorkflow(owner, workflowId, "id");
    return { scope, workflowId };
  }
  private key(owner: string, workflowId: string, scope: EditorVariableScope) {
    return RedisKeys.editorVariables(createHash("sha256").update(JSON.stringify([owner, workflowId, scope.sessionId, scope.mode, scope.batchId ?? null])).digest("hex"));
  }
  private async operation(owner: string, workflowId: string, scope: EditorVariableScope, operation: string, args: string[] = [], receipt = "") {
    let result: string;
    try { result = String(await getRedisCache().eval(SCRIPT, 1, this.key(owner, workflowId, scope), operation, EDITOR_VARIABLE_IDLE_SECONDS, ...Array.from({ length: 4 }, (_, i) => args[i] ?? ""), scope.createdAt, receipt)); }
    catch { throw Object.assign(new Error("Editor variable storage unavailable; execution cannot continue"), { statusCode: 503 }); }
    if (["closed", "expired", "conflict", "replay-conflict"].includes(result) && operation !== "close") {
      throw Object.assign(new Error(result === "closed" || result === "expired"
        ? `Variable scope ${result}; reload the editor or start a new Execute All`
        : "Variable revision/replay conflict; restart execution"), { statusCode: result === "closed" || result === "expired" ? 410 : 409 });
    }
    return result;
  }
  private decode(raw: string, owner: string, workflowId: string) {
    const record = JSON.parse(raw);
    return freezeVariableSnapshot(JSON.parse(record.snapshot), owner, workflowId);
  }
  async read(owner: string, workflowId: string, scope: EditorVariableScope): Promise<VariableSnapshot> {
    // Preview never opens or renews a scope.
    let raw: string | null;
    try { raw = await getRedisCache().get(this.key(owner, workflowId, scope)); }
    catch { throw Object.assign(new Error("Editor variable storage unavailable"), { statusCode: 503 }); }
    if (!raw) {
      if (Date.now() - scope.createdAt >= EDITOR_VARIABLE_IDLE_SECONDS * 1000) throw Object.assign(new Error("Variable scope expired; reload the editor"), { statusCode: 410 });
      return emptyVariableSnapshot(owner, workflowId);
    }
    if (JSON.parse(raw).closed || JSON.parse(raw).createdAt !== scope.createdAt) throw Object.assign(new Error("Variable scope closed"), { statusCode: 410 });
    return this.decode(raw, owner, workflowId);
  }
  async open(owner: string, workflowId: string, scope: EditorVariableScope) {
    const initial = Date.now() - scope.createdAt >= EDITOR_VARIABLE_IDLE_SECONDS * 1000 ? "expired"
      : JSON.stringify({ createdAt: scope.createdAt, revision: "0", snapshot: JSON.stringify(emptyVariableSnapshot(owner, workflowId)), receipts: {}, order: [], receiptBytes: 0 });
    return this.decode(await this.operation(owner, workflowId, scope, "open", [initial]), owner, workflowId);
  }
  async touch(owner: string, workflowId: string, scope: EditorVariableScope) {
    return this.decode(await this.operation(owner, workflowId, scope, "touch"), owner, workflowId);
  }
  async close(owner: string, workflowId: string, scope: EditorVariableScope) {
    await this.operation(owner, workflowId, scope, "close");
  }
  requestHash(request: unknown): string {
    return createHash("sha256").update(JSON.stringify(request)).digest("hex");
  }
  async prepare(scope: EditorVariableScope, snapshot: VariableSnapshot, revision: string, token: string, requestHash: string) {
    if (!snapshot.workflowId) throw new Error("Saved workflow required");
    const raw = await this.operation(snapshot.owner, snapshot.workflowId, scope, "prepare", [revision, requestHash, token]);
    return freezeVariableSnapshot(JSON.parse(raw), snapshot.owner, snapshot.workflowId);
  }
  async commit(scope: EditorVariableScope, snapshot: VariableSnapshot, changes: readonly VariableChange[], token: string, requestHash: string) {
    if (!snapshot.workflowId) throw new Error("Saved workflow required");
    if (new Set(changes.map(change => change.key)).size !== changes.length) throw new Error("Duplicate variable name");
    const next = overlayVariables(snapshot, changes);
    const committed = { ...next, revision: (BigInt(snapshot.revision) + 1n).toString(), values: undefined };
    const hash = createHash("sha256").update(JSON.stringify([snapshot.revision, changes])).digest("hex");
    return this.decode(await this.operation(snapshot.owner, snapshot.workflowId, scope, "commit", [snapshot.revision, JSON.stringify(committed), token, hash], JSON.stringify({ hash, requestHash, base: JSON.stringify({ ...snapshot, values: undefined }) })), snapshot.owner, snapshot.workflowId);
  }
}
export const editorVariables = new EditorVariableService();
