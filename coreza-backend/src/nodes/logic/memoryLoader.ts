import { BaseChatMessageHistory, BaseListChatMessageHistory } from "@langchain/core/chat_history";
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

const simpleMemoryStore = new Map<string, BaseMessage[]>();

class SimpleMemoryHistory extends BaseListChatMessageHistory {
  lc_namespace = ["coreza", "memory", "simple"];
  constructor(
    private readonly sessionId: string,
    private readonly limit: number,
  ) {
    super();
  }
  async getMessages(): Promise<BaseMessage[]> {
    return [...(simpleMemoryStore.get(this.sessionId) ?? [])];
  }
  async addMessage(message: BaseMessage): Promise<void> {
    const existing = simpleMemoryStore.get(this.sessionId) ?? [];
    const next = [...existing, message].slice(-this.limit);
    simpleMemoryStore.set(this.sessionId, next);
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
      throw new Error(`Supabase memory read failed: ${error.message}`);
    }
    const storedMessages: StoredMessage[] = (data ?? []).map((row: { message: Record<string, unknown> }) => {
      const { type, ...data } = row.message as { type: string; [k: string]: unknown };
      return { type, data } as StoredMessage;
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
  executionId?: string;
  resolveNodeParameters?: (node: WorkflowNode, input: NodeInput) => Record<string, unknown>;
};

export type LoadedMemory = {
  history: BaseChatMessageHistory;
  sessionId: string;
  windowMessages: number;
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
  const windowMessages = Math.max(1, contextWindowLength) * 2;

  if (memoryNode.name === "SimpleMemory") {
    return {
      history: new SimpleMemoryHistory(sessionId, windowMessages),
      sessionId,
      windowMessages,
    };
  }

  const userId = String(context.userId ?? "").trim();
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
  const clientJson = credentials?.client_json as Record<string, unknown> | undefined;

  if (memoryNode.name === "RedisChatMemory") {
    const sessionTTL = Number(values.sessionTTL ?? 0);
    const client = await getUserRedisConnection(userId, credentialId, {
      client_json: clientJson,
    });

    return {
      history: new RedisChatMessageHistory({
        sessionId,
        client,
        sessionTTL: sessionTTL > 0 ? sessionTTL : undefined,
      }),
      sessionId,
      windowMessages,
    };
  }

  if (memoryNode.name === "PostgresChatMemory") {
    const tableName = String(values.tableName ?? "").trim() || "coreza_chat_history";
    const url = typeof clientJson?.supabase_url === "string" ? clientJson.supabase_url : "";
    const key =
      typeof clientJson?.secret_key === "string"
        ? clientJson.secret_key
        : typeof clientJson?.service_role_key === "string"
          ? clientJson.service_role_key
          : "";
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
    };
  }

  throw new Error(`Unsupported Memory node type: ${memoryNode.name}`);
}
