import { describe, expect, it } from "vitest";
import {
  applyAgentRunEvent,
  type AgentRunMessageState,
} from "./agent-run-messages";
import type { AgentAction, AgentPlan, AgentRun } from "@/shared/types";

const createState = (): AgentRunMessageState => {
  const now = new Date().toISOString();
  const run: AgentRun = {
    id: "run_1",
    status: "created",
    goal: "goal",
    pageUrl: "https://example.com",
    pageTitle: "Example",
    modelRoute: {
      providerId: "minmax",
      modelId: "MiniMax-M2.7",
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    run,
    plan: null,
    events: [],
    pendingAction: null,
    results: [],
    messages: [],
  };
};

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

describe("agent-run message helpers", () => {
  it("appends streamed text and marks it done", () => {
    const state = createState();

    applyAgentRunEvent(state, {
      type: "message_delta",
      runId: "run_1",
      messageId: "message_1",
      text: "hello",
      channel: "answer",
    });
    applyAgentRunEvent(state, {
      type: "message_delta",
      runId: "run_1",
      messageId: "message_1",
      text: " world",
      channel: "answer",
      done: true,
    });

    expect(state.messages).toMatchObject([
      {
        id: "message_1",
        kind: "text",
        content: "hello world",
        streaming: false,
      },
    ]);
  });

  it("keeps plan state without adding visible plan messages", () => {
    const state = createState();
    const plan: AgentPlan = {
      summary: "Plan summary",
      steps: [action],
      blockedActions: [],
    };

    applyAgentRunEvent(state, {
      type: "plan",
      runId: "run_1",
      plan,
    });

    expect(state.plan).toBe(plan);
    expect(state.run?.plan).toBe(plan);
    expect(state.messages).toEqual([]);
  });

  it("does not add visible thinking messages", () => {
    const state = createState();

    applyAgentRunEvent(state, {
      type: "message_delta",
      runId: "run_1",
      messageId: "thinking_1",
      text: "thinking",
      channel: "thinking",
    });
    applyAgentRunEvent(state, {
      type: "message_delta",
      runId: "run_1",
      messageId: "thinking_1",
      text: "",
      channel: "thinking",
      done: true,
    });

    expect(state.events).toHaveLength(2);
    expect(state.messages).toEqual([]);
  });

  it("renders model reasoning deltas as a thinking message", () => {
    const state = createState();

    applyAgentRunEvent(state, {
      type: "message_delta",
      runId: "run_1",
      messageId: "reasoning_1",
      text: "先分析页面。",
      channel: "reasoning",
    });
    applyAgentRunEvent(state, {
      type: "message_delta",
      runId: "run_1",
      messageId: "reasoning_1",
      text: "",
      channel: "reasoning",
      done: true,
    });

    expect(state.messages).toMatchObject([
      {
        id: "reasoning_1",
        kind: "thinking",
        content: "先分析页面。",
        streaming: false,
      },
    ]);
  });

  it("tracks action requests and action results", () => {
    const state = createState();

    applyAgentRunEvent(state, {
      type: "action_request",
      runId: "run_1",
      action,
    });
    applyAgentRunEvent(state, {
      type: "action_result",
      runId: "run_1",
      result: {
        actionId: action.id,
        status: "succeeded",
        message: "Done",
      },
    });

    expect(state.pendingAction).toBe(action);
    expect(state.results).toHaveLength(1);
    expect(state.messages.map((message) => message.kind)).toEqual([
      "action_confirmation",
      "result",
    ]);
  });

  it("returns automatic actions and records errors", () => {
    const state = createState();
    const automaticAction = {
      ...action,
      id: "action_auto",
      requiresConfirmation: false,
    };

    const actionResult = applyAgentRunEvent(state, {
      type: "action_request",
      runId: "run_1",
      action: automaticAction,
    });
    const errorResult = applyAgentRunEvent(state, {
      type: "error",
      runId: "run_1",
      error: {
        code: "UNKNOWN_ERROR",
        message: "Boom",
        retryable: true,
      },
    });

    expect(actionResult.autoAction).toBe(automaticAction);
    expect(errorResult.error?.error.message).toBe("Boom");
    expect(state.messages.at(-1)).toMatchObject({
      kind: "error",
      content: "Boom",
    });
  });
});
