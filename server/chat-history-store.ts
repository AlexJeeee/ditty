import type Database from "better-sqlite3";
import { getDatabase } from "./db";
import type {
  ChatMessage,
  ChatSessionSnapshot,
  ChatSessionSummary,
  ModelConversationMessage,
} from "../src/shared/types";

interface ChatSessionRow {
  id: string;
  title: string;
  page_url: string;
  page_title: string;
  last_message_preview: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  snapshot_json: string;
}

const toSummary = (row: ChatSessionRow): ChatSessionSummary => ({
  id: row.id,
  title: row.title,
  pageUrl: row.page_url,
  pageTitle: row.page_title,
  lastMessagePreview: row.last_message_preview,
  messageCount: row.message_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeSnapshot = (
  snapshot: ChatSessionSnapshot,
): ChatSessionSnapshot => {
  const now = new Date().toISOString();

  return {
    ...snapshot,
    title: snapshot.title.trim() || "新对话",
    pageUrl: snapshot.pageUrl || "",
    pageTitle: snapshot.pageTitle || "",
    lastMessagePreview: snapshot.lastMessagePreview || "",
    createdAt: snapshot.createdAt || now,
    updatedAt: snapshot.updatedAt || now,
    run: snapshot.run ?? null,
    plan: snapshot.plan ?? null,
    events: Array.isArray(snapshot.events) ? snapshot.events : [],
    pendingAction: snapshot.pendingAction ?? null,
    results: Array.isArray(snapshot.results) ? snapshot.results : [],
    messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
    modelConversation: Array.isArray(snapshot.modelConversation)
      ? snapshot.modelConversation
      : [],
  };
};

export class ChatHistoryStore {
  private readonly db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  listSessions(): ChatSessionSummary[] {
    const rows = this.db
      .prepare(
        `
          SELECT id, title, page_url, page_title, last_message_preview,
            message_count, created_at, updated_at, snapshot_json
          FROM chat_sessions
          ORDER BY updated_at DESC
        `,
      )
      .all() as ChatSessionRow[];

    return rows.map(toSummary);
  }

  getSession(sessionId: string): ChatSessionSnapshot | null {
    const row = this.db
      .prepare(
        `
          SELECT id, title, page_url, page_title, last_message_preview,
            message_count, created_at, updated_at, snapshot_json
          FROM chat_sessions
          WHERE id = ?
        `,
      )
      .get(sessionId) as ChatSessionRow | undefined;

    if (!row) {
      return null;
    }

    return normalizeSnapshot(
      JSON.parse(row.snapshot_json) as ChatSessionSnapshot,
    );
  }

  upsertSession(snapshotValue: ChatSessionSnapshot): ChatSessionSnapshot {
    const snapshot = normalizeSnapshot(snapshotValue);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT INTO chat_sessions (
              id, title, page_url, page_title, last_message_preview,
              message_count, created_at, updated_at, snapshot_json
            )
            VALUES (
              @id, @title, @pageUrl, @pageTitle, @lastMessagePreview,
              @messageCount, @createdAt, @updatedAt, @snapshotJson
            )
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              page_url = excluded.page_url,
              page_title = excluded.page_title,
              last_message_preview = excluded.last_message_preview,
              message_count = excluded.message_count,
              updated_at = excluded.updated_at,
              snapshot_json = excluded.snapshot_json
          `,
        )
        .run({
          id: snapshot.id,
          title: snapshot.title,
          pageUrl: snapshot.pageUrl,
          pageTitle: snapshot.pageTitle,
          lastMessagePreview: snapshot.lastMessagePreview,
          messageCount: snapshot.messages.length,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
          snapshotJson: JSON.stringify(snapshot),
        });

      this.replaceMessages(snapshot.id, snapshot.messages);
      this.replaceConversation(snapshot.id, snapshot.modelConversation);
    });

    transaction();
    return snapshot;
  }

  deleteSession(sessionId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM chat_sessions WHERE id = ?")
      .run(sessionId);

    return result.changes > 0;
  }

  private replaceMessages(sessionId: string, messages: ChatMessage[]) {
    this.db
      .prepare("DELETE FROM chat_messages WHERE session_id = ?")
      .run(sessionId);

    const insertMessage = this.db.prepare(`
      INSERT INTO chat_messages (
        session_id, message_id, message_order, role, kind,
        content, created_at, message_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    messages.forEach((message, index) => {
      insertMessage.run(
        sessionId,
        message.id,
        index,
        message.role,
        message.kind,
        message.content,
        message.createdAt,
        JSON.stringify(message),
      );
    });
  }

  private replaceConversation(
    sessionId: string,
    conversation: ModelConversationMessage[],
  ) {
    this.db
      .prepare("DELETE FROM chat_conversation_messages WHERE session_id = ?")
      .run(sessionId);

    const insertConversationMessage = this.db.prepare(`
      INSERT INTO chat_conversation_messages (
        session_id, message_order, role, content, tool_call_id, message_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    conversation.forEach((message, index) => {
      insertConversationMessage.run(
        sessionId,
        index,
        message.role,
        message.content,
        message.role === "tool" ? message.tool_call_id : null,
        JSON.stringify(message),
      );
    });
  }
}

let chatHistoryStore: ChatHistoryStore | null = null;

export const getChatHistoryStore = () => {
  chatHistoryStore ??= new ChatHistoryStore();
  return chatHistoryStore;
};
