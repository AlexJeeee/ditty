import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthStore } from "./auth-store";
import { ChatHistoryStore } from "./chat-history-store";
import { createDatabase } from "./db";
import type { ChatSessionSnapshot } from "../src/shared/types";

const tempDirs: string[] = [];

const createTempStore = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-history-"));
  tempDirs.push(tempDir);
  const db = createDatabase(path.join(tempDir, "history.sqlite"));

  return {
    db,
    authStore: new AuthStore(db),
    store: new ChatHistoryStore(db),
  };
};

const createTestUsers = async (authStore: AuthStore) => {
  const userA = await authStore.register("a@example.com", "password123");
  const userB = await authStore.register("b@example.com", "password123");

  return {
    userA: userA.user.id,
    userB: userB.user.id,
  };
};

const createSnapshot = (
  id: string,
  updatedAt: string,
): ChatSessionSnapshot => ({
  id,
  title: `Session ${id}`,
  pageUrl: "https://example.com",
  pageTitle: "Example",
  lastMessagePreview: "Hello",
  createdAt: "2026-04-30T01:00:00.000Z",
  updatedAt,
  run: null,
  plan: null,
  events: [],
  pendingAction: null,
  results: [],
  messages: [
    {
      id: `message_${id}`,
      role: "user",
      kind: "text",
      content: "Hello",
      createdAt: updatedAt,
    },
  ],
  modelConversation: [
    {
      role: "user",
      content: "Prompt",
    },
    {
      role: "assistant",
      content: "Answer",
    },
  ],
});

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("ChatHistoryStore", () => {
  it("initializes the database schema", () => {
    const { db } = createTempStore();
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get("chat_sessions") as { name: string } | undefined;

    expect(row?.name).toBe("chat_sessions");
  });

  it("migrates an existing chat_sessions table before creating user indexes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-history-"));
    tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, "history.sqlite");
    const db = createDatabase(dbPath);

    db.prepare("DROP TABLE chat_conversation_messages").run();
    db.prepare("DROP TABLE chat_messages").run();
    db.prepare("DROP INDEX IF EXISTS idx_chat_sessions_updated_at").run();
    db.prepare("DROP TABLE chat_sessions").run();
    db.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        page_url TEXT NOT NULL DEFAULT '',
        page_title TEXT NOT NULL DEFAULT '',
        last_message_preview TEXT NOT NULL DEFAULT '',
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
    `);
    db.close();

    const migratedDb = createDatabase(dbPath);
    const columns = migratedDb
      .prepare("PRAGMA table_info(chat_sessions)")
      .all() as { name: string }[];
    const index = migratedDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
      )
      .get("idx_chat_sessions_user_updated_at") as { name: string } | undefined;

    expect(columns.some((column) => column.name === "user_id")).toBe(true);
    expect(index?.name).toBe("idx_chat_sessions_user_updated_at");

    migratedDb.close();
  });

  it("upserts, reads, and sorts chat sessions by updatedAt", async () => {
    const { authStore, store } = createTempStore();
    const { userA } = await createTestUsers(authStore);
    const older = createSnapshot("chat_old", "2026-04-30T01:00:00.000Z");
    const newer = createSnapshot("chat_new", "2026-04-30T02:00:00.000Z");

    store.upsertSession(userA, older);
    store.upsertSession(userA, newer);

    expect(store.listSessions(userA).map((session) => session.id)).toEqual([
      "chat_new",
      "chat_old",
    ]);
    expect(store.getSession(userA, "chat_old")).toMatchObject({
      id: "chat_old",
      title: "Session chat_old",
      messages: [{ content: "Hello" }],
    });
  });

  it("replaces message and conversation rows on upsert", async () => {
    const { authStore, db, store } = createTempStore();
    const { userA } = await createTestUsers(authStore);
    const snapshot = createSnapshot("chat_replace", "2026-04-30T01:00:00.000Z");

    store.upsertSession(userA, snapshot);
    store.upsertSession(userA, {
      ...snapshot,
      updatedAt: "2026-04-30T02:00:00.000Z",
      messages: [
        {
          id: "message_replaced",
          role: "assistant",
          kind: "text",
          content: "Replaced",
          createdAt: "2026-04-30T02:00:00.000Z",
        },
      ],
      modelConversation: [
        {
          role: "assistant",
          content: "Replaced",
        },
      ],
    });

    const messageCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?",
      )
      .get("chat_replace") as { count: number };
    const conversationCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM chat_conversation_messages WHERE session_id = ?",
      )
      .get("chat_replace") as { count: number };

    expect(messageCount.count).toBe(1);
    expect(conversationCount.count).toBe(1);
    expect(store.getSession(userA, "chat_replace")?.messages[0]?.content).toBe(
      "Replaced",
    );
  });

  it("deletes sessions and cascades child rows", async () => {
    const { authStore, db, store } = createTempStore();
    const { userA } = await createTestUsers(authStore);

    store.upsertSession(
      userA,
      createSnapshot("chat_delete", "2026-04-30T01:00:00.000Z"),
    );

    expect(store.deleteSession(userA, "chat_delete")).toBe(true);
    expect(store.getSession(userA, "chat_delete")).toBeNull();
    expect(store.listSessions(userA)).toEqual([]);

    const messageCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?",
      )
      .get("chat_delete") as { count: number };

    expect(messageCount.count).toBe(0);
  });

  it("isolates sessions by user", async () => {
    const { authStore, store } = createTempStore();
    const { userA, userB } = await createTestUsers(authStore);

    store.upsertSession(
      userA,
      createSnapshot("chat_shared", "2026-04-30T01:00:00.000Z"),
    );

    expect(store.listSessions(userB)).toEqual([]);
    expect(store.getSession(userB, "chat_shared")).toBeNull();
    expect(store.deleteSession(userB, "chat_shared")).toBe(false);
    expect(() =>
      store.upsertSession(
        userB,
        createSnapshot("chat_shared", "2026-04-30T02:00:00.000Z"),
      ),
    ).toThrow("聊天会话不存在。");
    expect(store.getSession(userA, "chat_shared")?.id).toBe("chat_shared");
  });
});
