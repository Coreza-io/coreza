import { BaseChatMessageHistory, BaseListChatMessageHistory } from "@langchain/core/chat_history";
import { BaseMessage, mapChatMessagesToStoredMessages, mapStoredMessagesToChatMessages } from "@langchain/core/messages";
import { RedisChatMessageHistory } from "@langchain/community/stores/message/ioredis";
import Redis from "ioredis";
import { Pool } from "pg";
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

class PostgresNoInitHistory extends BaseListChatMessageHistory {
  lc_namespace = ["coreza", "memory", "postgres"];
  constructor(
    private readonly pool: Pool,
    private readonly tableName: string,
    private readonly sessionId: string,
  ) {
    super();
  }
  async getMessages(): Promise<BaseMessage[]> {
    const query = `SELECT message FROM ${this.tableName} WHERE session_id = $1 ORDER BY id`;
    const res = await this.pool.query<{ message: Record<string, unknown> }>(query, [this.sessionId]);
    const storedMessages = res.rows.map((row: { message: Record<string, unknown> }) => {
      const { type, ...data } = row.message as { type: string; [k: string]: unknown };
      return { type, data };
    });
    return mapStoredMessagesToChatMessages(storedMessages);
  }
  async addMessage(message: BaseMessage): Promise<void> {
    const [stored] = mapChatMessagesToStoredMessages([message]);
    const query = `INSERT INTO ${this.tableName} (session_id, message) VALUES ($1, $2)`;
    await this.pool.query(query, [
      this.sessionId,
      {
        ...stored.data,
        type: stored.type,
      },
    ]);
  }
  async clear(): Promise<void> {
    const query = `DELETE FROM ${this.tableName} WHERE session_id = $1`;
    await this.pool.query(query, [this.sessionId]);
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

  const { credentials } = await CredentialManager.getCredentials(
    userId,
    memoryNode.name?.toLowerCase?.() ?? "",
    credentialId,
  );
  const clientJson = credentials?.client_json as Record<string, unknown> | undefined;

  if (memoryNode.name === "RedisChatMemory") {
    if (!clientJson?.host || !clientJson?.port) {
      throw new Error("Redis Chat Memory credential is invalid");
    }

    const sessionTTL = Number(values.sessionTTL ?? 0);
    const client = new Redis({
      host: String(clientJson.host),
      port: Number(clientJson.port),
      username: clientJson.username ? String(clientJson.username) : undefined,
      password: clientJson.password ? String(clientJson.password) : undefined,
      db: clientJson.db !== undefined ? Number(clientJson.db) : undefined,
      tls: clientJson.tls ? {} : undefined,
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
    const tableName = String(values.tableName ?? "").trim();
    if (!tableName) {
      throw new Error("Postgres Chat Memory requires tableName");
    }
    if (!clientJson?.host || !clientJson?.port || !clientJson?.database) {
      throw new Error("Postgres Chat Memory credential is invalid");
    }

    const pool = new Pool({
      host: String(clientJson.host),
      port: Number(clientJson.port),
      user: clientJson.user ? String(clientJson.user) : undefined,
      password: clientJson.password ? String(clientJson.password) : undefined,
      database: String(clientJson.database),
      ssl: clientJson.ssl ? { rejectUnauthorized: false } : undefined,
    });

    return {
      history: new PostgresNoInitHistory(pool, tableName, sessionId),
      sessionId,
      windowMessages,
    };
  }

  throw new Error(`Unsupported Memory node type: ${memoryNode.name}`);
}
