import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    store: new ChatHistoryStore(db),
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

  it("upserts, reads, and sorts chat sessions by updatedAt", () => {
    const { store } = createTempStore();
    const older = createSnapshot("chat_old", "2026-04-30T01:00:00.000Z");
    const newer = createSnapshot("chat_new", "2026-04-30T02:00:00.000Z");

    store.upsertSession(older);
    store.upsertSession(newer);

    expect(store.listSessions().map((session) => session.id)).toEqual([
      "chat_new",
      "chat_old",
    ]);
    expect(store.getSession("chat_old")).toMatchObject({
      id: "chat_old",
      title: "Session chat_old",
      messages: [{ content: "Hello" }],
    });
  });

  it("replaces message and conversation rows on upsert", () => {
    const { db, store } = createTempStore();
    const snapshot = createSnapshot("chat_replace", "2026-04-30T01:00:00.000Z");

    store.upsertSession(snapshot);
    store.upsertSession({
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
    expect(store.getSession("chat_replace")?.messages[0]?.content).toBe(
      "Replaced",
    );
  });

  it("deletes sessions and cascades child rows", () => {
    const { db, store } = createTempStore();

    store.upsertSession(
      createSnapshot("chat_delete", "2026-04-30T01:00:00.000Z"),
    );

    expect(store.deleteSession("chat_delete")).toBe(true);
    expect(store.getSession("chat_delete")).toBeNull();
    expect(store.listSessions()).toEqual([]);

    const messageCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?",
      )
      .get("chat_delete") as { count: number };

    expect(messageCount.count).toBe(0);
  });
});
