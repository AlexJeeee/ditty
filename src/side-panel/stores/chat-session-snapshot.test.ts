import { describe, expect, it } from "vitest";
import {
  sanitizeMessagesForPersistence,
  sanitizeSnapshotForHydration,
} from "./chat-session-snapshot";
import type {
  AgentAction,
  ChatMessage,
  ChatSessionSnapshot,
} from "@/shared/types";

const action: AgentAction = {
  id: "action_1",
  toolName: "open_url",
  riskLevel: "medium",
  requiresConfirmation: true,
  target: {
    description: "Example",
  },
  input: {
    url: "https://example.com",
  },
  reason: "Open Example",
};

const createSnapshot = (messages: ChatMessage[]): ChatSessionSnapshot => ({
  id: "chat_1",
  title: "Chat",
  pageUrl: "https://example.com",
  pageTitle: "Example",
  lastMessagePreview: "Preview",
  createdAt: "2026-04-30T01:00:00.000Z",
  updatedAt: "2026-04-30T01:00:00.000Z",
  run: null,
  plan: null,
  events: [],
  pendingAction: action,
  results: [],
  messages,
  modelConversation: [],
});

describe("chat session snapshot helpers", () => {
  it("filters the welcome message from persisted snapshots", () => {
    const messages = sanitizeMessagesForPersistence([
      {
        id: "welcome",
        role: "assistant",
        kind: "text",
        content: "Welcome",
        createdAt: "2026-04-30T01:00:00.000Z",
      },
      {
        id: "message_1",
        role: "assistant",
        kind: "text",
        content: "Hello",
        createdAt: "2026-04-30T01:00:01.000Z",
        streaming: true,
      },
    ]);

    expect(messages).toEqual([
      {
        id: "message_1",
        role: "assistant",
        kind: "text",
        content: "Hello",
        createdAt: "2026-04-30T01:00:01.000Z",
        streaming: false,
      },
    ]);
  });

  it("stops streaming messages when hydrating a historical chat", () => {
    const snapshot = sanitizeSnapshotForHydration(
      createSnapshot([
        {
          id: "message_1",
          role: "assistant",
          kind: "text",
          content: "Streaming",
          createdAt: "2026-04-30T01:00:01.000Z",
          streaming: true,
        },
      ]),
    );

    expect(snapshot.messages[0]?.streaming).toBe(false);
  });

  it("removes executable pending actions from historical chats", () => {
    const snapshot = sanitizeSnapshotForHydration(
      createSnapshot([
        {
          id: "action_action_1",
          role: "assistant",
          kind: "action_confirmation",
          content: "Confirm",
          createdAt: "2026-04-30T01:00:01.000Z",
          action,
          actionStatus: "pending",
        },
      ]),
    );

    expect(snapshot.pendingAction).toBeNull();
    expect(snapshot.messages[0]).toMatchObject({
      actionStatus: "rejected",
    });
  });
});
