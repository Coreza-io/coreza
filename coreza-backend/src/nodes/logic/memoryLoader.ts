import {
  BaseChatMessageHistory,
  BaseListChatMessageHistory,
} from "@langchain/core/chat_history";
import {
  BaseMessage,
  StoredMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages";
import { RedisChatMessageHistory } from "@langchain/community/stores/message/ioredis";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getUserRedisConnection } from "../../services/storage/helpers/redisConnection";
import CredentialManager from "../../utils/credentialManager";
import { NodeInput, WorkflowEdge, WorkflowNode } from "../types";

// v2 deliberately does not import legacy unscoped process-local conversations.
const simpleMemoryStore = new Map<string, { messages: BaseMessage[]; accessed: number; bytes: number }>();
const SIMPLE_SESSION_TTL = 30 * 60_000;
const MAX_SIMPLE_SESSIONS = 512;
const conversations = new Map<string, { tail: Promise<void>; pending: number }>();

/** Process-local read/invoke/write ordering, with bounded, cancellable waiters. */
export async function acquireMemoryConversation(key: string, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) { const error = new Error("Agent cancelled"); error.name = "AbortError"; throw error; }
  const previous = conversations.get(key);
  if ((!previous && conversations.size >= 128) || (previous?.pending ?? 0) >= 16)
    throw new Error("Memory conversation capacity reached");
  let unlock!: () => void;
  const ready = previous?.tail ?? Promise.resolve();
  const own = new Promise<void>(resolve => { unlock = resolve; });
  const entry = { tail: ready.then(() => own), pending: (previous?.pending ?? 0) + 1 };
  conversations.set(key, entry);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    unlock();
    const current = conversations.get(key);
    if (current) current.pending--;
    if (current === entry && current.pending === 0) conversations.delete(key);
  };
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([ready, new Promise<never>((_, reject) => {
      onAbort = () => { const error = new Error("Agent cancelled"); error.name = "AbortError"; reject(error); };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    })]);
    return release;
  } catch (error) {
    // Do not let an aborted waiter allow a later invocation past its predecessor.
    void ready.then(release);
    throw error;
  } finally { if (onAbort) signal?.removeEventListener("abort", onAbort); }
}

function readSimpleSession(key: string): BaseMessage[] {
  const now = Date.now();
  for (const [id, entry] of simpleMemoryStore) if (now - entry.accessed > SIMPLE_SESSION_TTL) simpleMemoryStore.delete(id);
  const entry = simpleMemoryStore.get(key);
  if (!entry) return [];
  simpleMemoryStore.delete(key);
  simpleMemoryStore.set(key, { ...entry, accessed: now });
  return entry.messages;
}

class SimpleMemoryHistory extends BaseListChatMessageHistory {
  lc_namespace = ["coreza", "memory", "simple"];
  constructor(
    private readonly sessionId: string,
    private readonly limit: number,
  ) {
    super();
  }
  async getMessages(): Promise<BaseMessage[]> {
    return [...readSimpleSession(this.sessionId)];
  }
  async addMessage(message: BaseMessage): Promise<void> {
    await this.addMessages([message]);
  }
  async addMessages(messages: BaseMessage[]): Promise<void> {
    const next = [...readSimpleSession(this.sessionId), ...messages].slice(-this.limit);
    const bytes = Buffer.byteLength(JSON.stringify(mapChatMessagesToStoredMessages(next)));
    if (bytes > 2 * 1024 * 1024) throw new Error("SimpleMemory conversation exceeds 2 MB");
    // Stage the full pair before publication; retain chronological append order.
    simpleMemoryStore.delete(this.sessionId);
    simpleMemoryStore.set(this.sessionId, { messages: next, accessed: Date.now(), bytes });
    let total = [...simpleMemoryStore.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (simpleMemoryStore.size > MAX_SIMPLE_SESSIONS || total > 32 * 1024 * 1024) {
      const oldest = simpleMemoryStore.keys().next().value!;
      total -= simpleMemoryStore.get(oldest)!.bytes;
      simpleMemoryStore.delete(oldest);
    }
  }
  async clear(): Promise<void> {
    simpleMemoryStore.delete(this.sessionId);
  }
}

class SupabaseChatMessageHistory extends BaseListChatMessageHistory {
  lc_namespace = ["coreza", "memory", "supabase"];
  constructor(
    private readonly client: SupabaseClient,
    private readonly tableName: string,
    private readonly sessionId: string,
  ) {
    super();
  }
  async getMessages(): Promise<BaseMessage[]> {
    const { data, error } = await this.client
      .from(this.tableName)
      .select("message")
      .eq("session_id", this.sessionId)
      .order("id", { ascending: true });

    if (error) {
      throw new Error(`Failed to get messages: ${error.message}`);
    }

    const storedMessages: StoredMessage[] = (data ?? []).map((row) => {
      return row.message as unknown as StoredMessage;
    });

    return mapStoredMessagesToChatMessages(storedMessages);
  }
  async addMessage(message: BaseMessage): Promise<void> {
    const [stored] = mapChatMessagesToStoredMessages([message]);
    const { error } = await this.client.from(this.tableName).insert({
      session_id: this.sessionId,
      message: {
        ...stored.data,
        type: stored.type,
      },
    });
    if (error) {
      throw new Error(`Supabase memory write failed: ${error.message}`);
    }
  }
  async clear(): Promise<void> {
    const { error } = await this.client
      .from(this.tableName)
      .delete()
      .eq("session_id", this.sessionId);
    if (error) {
      throw new Error(`Supabase memory clear failed: ${error.message}`);
    }
  }
}

type MemoryLoaderContext = {
  userId?: string;
  workflowId?: string;
  executionId?: string;
  resolveNodeParameters?: (
    node: WorkflowNode,
    input: NodeInput,
  ) => Record<string, unknown>;
};

export type LoadedMemory = {
  history: BaseChatMessageHistory;
  sessionId: string;
  windowMessages: number;
  conversationKey: string;
} | null;

export async function loadMemoryFromEdges(
  agentNode: WorkflowNode,
  edges: WorkflowEdge[],
  allNodes: WorkflowNode[],
  context: MemoryLoaderContext,
  input: NodeInput,
): Promise<LoadedMemory> {
  const memoryEdges = edges.filter(
    (edge) => edge.target === agentNode.id && edge.targetHandle === "memory",
  );

  if (memoryEdges.length === 0) return null;
  if (memoryEdges.length > 1) {
    throw new Error("Only one Memory node can be connected to an AI Agent");
  }

  const memoryNode = allNodes.find((node) => node.id === memoryEdges[0].source);
  if (!memoryNode) {
    throw new Error("Connected Memory node not found");
  }

  const values = context.resolveNodeParameters
    ? context.resolveNodeParameters(memoryNode, input)
    : { ...(memoryNode.values ?? {}) };

  const sessionKey = String(values.sessionKey ?? "").trim();
  const executionId = String(context.executionId ?? "").trim();
  const sessionId = sessionKey || executionId;
  if (!sessionId) {
    throw new Error("executionId is required when sessionKey is empty");
  }

  const contextWindowLength = Number(values.contextWindowLength ?? 5);
  if (!Number.isFinite(contextWindowLength) || contextWindowLength < 1 || contextWindowLength > 500)
    throw new Error("Memory context window must be between 1 and 500");
  const windowMessages = Math.floor(contextWindowLength) * 2;
  const userId = String(context.userId ?? "").trim();
  const workflowId = String(context.workflowId ?? "").trim();
  if (!userId || !workflowId) throw new Error("Memory requires userId and workflowId");
  const conversationKey = JSON.stringify(["v2", userId, workflowId, memoryNode.id, sessionId]);

  if (memoryNode.name === "SimpleMemory") {
    return {
      history: new SimpleMemoryHistory(conversationKey, windowMessages),
      sessionId,
      windowMessages,
      conversationKey,
    };
  }

  const scopedRedisSessionId = `coreza_chat_history:userId:${userId}:workflowId:${workflowId}:sessionId:${sessionId}`;
  const credentialId = String(values.credential_id ?? "").trim();
  if (!userId || !credentialId) {
    throw new Error(`${memoryNode.name} requires userId and credential_id`);
  }

  const serviceTypeByNode: Record<string, string> = {
    RedisChatMemory: "redis",
    PostgresChatMemory: "supabase",
  };
  const serviceType = serviceTypeByNode[memoryNode.name ?? ""];
  if (!serviceType) {
    throw new Error(`Unsupported Memory node type: ${memoryNode.name}`);
  }

  const { credentials } = await CredentialManager.getCredentials(
    userId,
    serviceType,
    credentialId,
  );
  const clientJson = credentials?.client_json as
    | Record<string, unknown>
    | undefined;

  if (memoryNode.name === "RedisChatMemory") {
    const sessionTTL = Number(values.sessionTTL ?? 0);
    const client = await getUserRedisConnection(userId, credentialId, {
      client_json: clientJson,
    });

    return {
      history: new RedisChatMessageHistory({
        sessionId: scopedRedisSessionId,
        client,
        sessionTTL: sessionTTL > 0 ? sessionTTL : undefined,
      }),
      sessionId,
      windowMessages,
      conversationKey: JSON.stringify(["redis", userId, credentialId, scopedRedisSessionId]),
    };
  }

  if (memoryNode.name === "PostgresChatMemory") {
    const tableName =
      String(values.tableName ?? "").trim() || "coreza_chat_history";
    const url =
      typeof clientJson?.supabase_url === "string"
        ? clientJson.supabase_url
        : "";
    const key =
      typeof clientJson?.secret_key === "string" ? clientJson.secret_key : "";
    if (!url || !key) {
      throw new Error("Supabase credential is invalid");
    }

    const client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    return {
      history: new SupabaseChatMessageHistory(client, tableName, sessionId),
      sessionId,
      windowMessages,
      conversationKey: JSON.stringify(["postgres", userId, credentialId, tableName, sessionId]),
    };
  }

  throw new Error(`Unsupported Memory node type: ${memoryNode.name}`);
}
