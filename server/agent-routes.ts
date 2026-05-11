import type { FastifyInstance } from "fastify";
import {
  getModel,
  getOpenAIBaseUrl,
  getOpenAITimeoutMs,
  requireOpenAIClient,
} from "./config";
import { buildPrompt, createPlan, SYSTEM_PROMPT } from "./agent-prompt";
import {
  accumulateToolCalls,
  createActionFromToolCall,
  hasModelToolDefinition,
  MODEL_CHAT_TOOLS,
  type ToolCallAccumulator,
} from "./model-tools";
import {
  activeStreams,
  runs,
  setRunStatus,
  validatePageContext,
  type StoredRun,
} from "./run-store";
import { getChatHistoryStore } from "./chat-history-store";
import { getAuthStore, type AuthStore } from "./auth-store";
import { requireAuthenticatedUser } from "./auth-routes";
import type { ChatHistoryStore } from "./chat-history-store";
import {
  toErrorEvent,
  writeAssistantDone,
  writeSseDone,
  writeSseEvent,
} from "./sse";
import { createScopedId } from "../src/shared/id";
import type {
  AgentRun,
  ChatSessionSnapshot,
  ModelConversationMessage,
  ModelToolCall,
  PageContext,
} from "../src/shared/types";
import type { ServerResponse } from "node:http";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

interface CreateAgentRunBody {
  goal?: string;
  pageContext?: PageContext;
  conversation?: ModelConversationMessage[];
}

interface StreamAgentRunBody {
  pageContext?: PageContext;
  conversation?: ModelConversationMessage[];
}

interface UpsertChatSessionBody {
  snapshot?: ChatSessionSnapshot;
}

interface AgentRouteOptions {
  authStore?: AuthStore;
  chatHistoryStore?: ChatHistoryStore;
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CONTENT_LENGTH = 12000;

const truncateHistoryContent = (content: string) => {
  return content.length > MAX_HISTORY_CONTENT_LENGTH
    ? `${content.slice(0, MAX_HISTORY_CONTENT_LENGTH)}\n...[truncated]`
    : content;
};

const validateConversation = (value: unknown): ModelConversationMessage[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const messages: ModelConversationMessage[] = [];

  for (const item of value.slice(-MAX_HISTORY_MESSAGES)) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const message = item as Partial<ModelConversationMessage>;

    if (message.role === "user" && typeof message.content === "string") {
      messages.push({
        role: "user",
        content: truncateHistoryContent(message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      const assistantMessage: ModelConversationMessage = {
        role: "assistant",
        content:
          typeof message.content === "string"
            ? truncateHistoryContent(message.content)
            : null,
      };

      if (Array.isArray(message.tool_calls)) {
        const toolCalls = message.tool_calls
          .filter(
            (toolCall): toolCall is ModelToolCall =>
              Boolean(toolCall) &&
              toolCall.type === "function" &&
              typeof toolCall.id === "string" &&
              typeof toolCall.function?.name === "string" &&
              typeof toolCall.function.arguments === "string",
          )
          .map((toolCall) => ({
            id: toolCall.id,
            type: "function" as const,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          }));

        if (toolCalls.length) {
          assistantMessage.tool_calls = toolCalls;
        }
      }

      messages.push(assistantMessage);
      continue;
    }

    if (
      message.role === "tool" &&
      typeof message.tool_call_id === "string" &&
      typeof message.content === "string"
    ) {
      messages.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: truncateHistoryContent(message.content),
      });
    }
  }

  return messages;
};

const toOpenAIMessage = (
  message: ModelConversationMessage,
): ChatCompletionMessageParam => {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.tool_calls,
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.tool_call_id,
      content: message.content,
    };
  }

  return {
    role: "user",
    content: message.content,
  };
};

const createAssistantConversationMessage = (
  content: string,
  toolCalls: ToolCallAccumulator[],
): ModelConversationMessage => {
  const validToolCalls = toolCalls
    .filter((toolCall) => toolCall.name)
    .map((toolCall) => ({
      id: toolCall.id,
      type: "function" as const,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    }));

  return {
    role: "assistant",
    content: content || null,
    ...(validToolCalls.length ? { tool_calls: validToolCalls } : {}),
  };
};

const appendConversationMessage = (
  raw: ServerResponse,
  stored: StoredRun,
  message: ModelConversationMessage,
) => {
  stored.conversation.push(message);
  writeSseEvent(raw, {
    type: "conversation_message",
    runId: stored.run.id,
    message,
  });
};

const ensureToolCallIds = (toolCalls: ToolCallAccumulator[]) => {
  toolCalls.forEach((toolCall, index) => {
    if (!toolCall.id) {
      toolCall.id = createScopedId(`tool_${index}`);
    }
  });
};

/**
 * Streams an OpenAI chat completion for the given run and writes SSE events
 * directly to `raw`. Handles tool-call accumulation, action creation, and all
 * run-status transitions. Returns when the stream is fully consumed or aborted.
 */
const streamOpenAICompletion = async (
  raw: ServerResponse,
  stored: StoredRun,
  abortController: AbortController,
): Promise<void> => {
  const { run } = stored;
  const model = getModel();
  const messageId = createScopedId("openai");
  const openai = requireOpenAIClient();
  const toolCalls: ToolCallAccumulator[] = [];
  let assistantContent = "";
  let hasAnswerText = false;

  const stream = await openai.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...stored.conversation.map(toOpenAIMessage),
      ],
      tools: MODEL_CHAT_TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: false,
      stream: true,
    },
    { signal: abortController.signal },
  );

  for await (const chunk of stream) {
    const choiceDelta = chunk.choices[0]?.delta;
    const delta = choiceDelta?.content;

    if (typeof delta === "string" && delta.length > 0) {
      hasAnswerText = true;
      assistantContent += delta;
      writeSseEvent(raw, {
        type: "message_delta",
        runId: run.id,
        messageId,
        text: delta,
        channel: "answer",
      });
    }

    if (choiceDelta?.tool_calls?.length) {
      accumulateToolCalls(toolCalls, choiceDelta.tool_calls);
    }
  }

  ensureToolCallIds(toolCalls);
  const assistantMessage = createAssistantConversationMessage(
    assistantContent,
    toolCalls,
  );
  appendConversationMessage(raw, stored, assistantMessage);

  if (hasAnswerText) {
    writeAssistantDone(raw, run.id, messageId);
  }

  const requestedToolCall =
    toolCalls.find((tc) => hasModelToolDefinition(tc.name)) ?? toolCalls[0];

  if (requestedToolCall) {
    const { action, blockedReason } = createActionFromToolCall(
      requestedToolCall,
      createScopedId("action"),
    );

    if (action) {
      if (!hasAnswerText) {
        writeSseEvent(raw, {
          type: "message_delta",
          runId: run.id,
          messageId,
          text: action.requiresConfirmation
            ? "我已准备好一个需要确认的动作，请确认后我再执行。"
            : "我已准备好一个安全动作，会直接执行并返回结果。",
          channel: "answer",
        });
        writeAssistantDone(raw, run.id, messageId);
      }

      writeSseEvent(raw, { type: "action_request", runId: run.id, action });

      if (action.requiresConfirmation) {
        setRunStatus(stored, "requires_confirmation");
        writeSseEvent(raw, {
          type: "status",
          runId: run.id,
          status: "requires_confirmation",
        });
      }
    } else {
      if (requestedToolCall.id) {
        appendConversationMessage(raw, stored, {
          role: "tool",
          tool_call_id: requestedToolCall.id,
          content: blockedReason || "模型请求的工具动作未通过本地校验。",
        });
      }

      writeSseEvent(raw, {
        type: "message_delta",
        runId: run.id,
        messageId,
        text: blockedReason || "模型请求的工具动作未通过本地校验。",
        channel: "answer",
      });
      writeAssistantDone(raw, run.id, messageId);
      setRunStatus(stored, "blocked");
      writeSseEvent(raw, { type: "status", runId: run.id, status: "blocked" });
    }
  } else {
    if (!hasAnswerText) {
      writeSseEvent(raw, {
        type: "message_delta",
        runId: run.id,
        messageId,
        text: "我没有找到需要执行的新动作，会继续停留在当前页面对话。",
        channel: "answer",
      });
      writeAssistantDone(raw, run.id, messageId);
    }

    setRunStatus(stored, "completed");
    writeSseEvent(raw, { type: "status", runId: run.id, status: "completed" });
  }
};

export const registerAgentRoutes = (
  fastify: FastifyInstance,
  options: AgentRouteOptions = {},
) => {
  const chatHistoryStore = options.chatHistoryStore ?? getChatHistoryStore();
  const authStore = options.authStore ?? getAuthStore();

  fastify.get("/health", async () => ({
    ok: true,
    model: getModel(),
    openaiTimeoutMs: getOpenAITimeoutMs(),
  }));

  fastify.get("/health/openai", async (_request, reply) => {
    try {
      const startedAt = Date.now();
      const openai = requireOpenAIClient();
      await openai.models.list();

      return {
        ok: true,
        model: getModel(),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        error: {
          message:
            error instanceof Error ? error.message : "OpenAI API 不可达。",
          timeoutMs: getOpenAITimeoutMs(),
          baseURL: getOpenAIBaseUrl(),
        },
      });
    }
  });

  fastify.get("/api/chat/sessions", async (request, reply) => {
    const user = requireAuthenticatedUser(request, reply, authStore);

    if (!user) {
      return reply;
    }

    return chatHistoryStore.listSessions(user.id);
  });

  fastify.get<{ Params: { sessionId: string } }>(
    "/api/chat/sessions/:sessionId",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply, authStore);

      if (!user) {
        return reply;
      }

      const snapshot = chatHistoryStore.getSession(
        user.id,
        request.params.sessionId,
      );

      if (!snapshot) {
        return reply.code(404).send({
          error: {
            message: "聊天会话不存在。",
          },
        });
      }

      return snapshot;
    },
  );

  fastify.put<{
    Params: { sessionId: string };
    Body: UpsertChatSessionBody;
  }>("/api/chat/sessions/:sessionId", async (request, reply) => {
    const user = requireAuthenticatedUser(request, reply, authStore);

    if (!user) {
      return reply;
    }

    const snapshot = request.body?.snapshot;

    if (!snapshot || typeof snapshot !== "object") {
      return reply.code(400).send({
        error: {
          message: "聊天快照缺失。",
        },
      });
    }

    return chatHistoryStore.upsertSession(user.id, {
      ...snapshot,
      id: request.params.sessionId,
    });
  });

  fastify.delete<{ Params: { sessionId: string } }>(
    "/api/chat/sessions/:sessionId",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply, authStore);

      if (!user) {
        return reply;
      }

      const deleted = chatHistoryStore.deleteSession(
        user.id,
        request.params.sessionId,
      );

      return {
        ok: true,
        deleted,
      };
    },
  );

  fastify.post<{ Body: CreateAgentRunBody }>(
    "/api/agent/runs",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply, authStore);

      if (!user) {
        return reply;
      }

      try {
        const goal = request.body?.goal?.trim();

        if (!goal) {
          return reply.code(400).send({
            error: {
              message: "goal 不能为空。",
            },
          });
        }

        const pageContext = validatePageContext(request.body?.pageContext);
        authStore.deductQuota(user.id);
        const currentUserMessage: ModelConversationMessage & {
          role: "user";
        } = {
          role: "user",
          content: buildPrompt(goal, pageContext),
        };
        const now = new Date().toISOString();
        const run: AgentRun = {
          id: createScopedId("run"),
          status: "created",
          goal,
          pageUrl: pageContext.url,
          pageTitle: pageContext.title,
          createdAt: now,
          updatedAt: now,
        };

        runs.set(run.id, {
          run,
          userId: user.id,
          goal,
          pageContext,
          conversation: [
            ...validateConversation(request.body?.conversation),
            currentUserMessage,
          ],
          currentUserMessage,
          currentUserMessageEmitted: false,
        });

        return run;
      } catch (error) {
        return reply
          .code(
            error instanceof Error && error.message === "额度不足。"
              ? 403
              : 400,
          )
          .send({
            error: {
              message:
                error instanceof Error
                  ? error.message
                  : "创建 Agent Run 失败。",
            },
          });
      }
    },
  );

  fastify.post<{ Params: { runId: string }; Body: StreamAgentRunBody }>(
    "/api/agent/runs/:runId/stream",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply, authStore);

      if (!user) {
        return reply;
      }

      const stored = runs.get(request.params.runId);

      if (!stored || stored.userId !== user.id) {
        return reply.code(404).send({
          error: {
            message: "Agent Run 不存在或服务已重启，请重新发起任务。",
          },
        });
      }

      const { run } = stored;
      const continuationConversation = request.body?.conversation
        ? validateConversation(request.body.conversation)
        : null;
      const pageContext = request.body?.pageContext
        ? validatePageContext(request.body.pageContext)
        : stored.pageContext;
      const isContinuation = Boolean(continuationConversation);
      const abortController = new AbortController();
      let clientClosed = false;

      if (continuationConversation) {
        stored.conversation = continuationConversation;
        stored.pageContext = pageContext;
      }

      activeStreams.get(run.id)?.abortController.abort();
      activeStreams.set(run.id, { abortController });

      reply.hijack();
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) {
          clientClosed = true;
          abortController.abort();
        }
      });
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders?.();

      // Emit planning phase events before calling OpenAI.
      const model = getModel();
      const thinkingMessageId = createScopedId("thinking");
      setRunStatus(stored, "planning");
      writeSseEvent(reply.raw, {
        type: "status",
        runId: run.id,
        status: "planning",
      });
      if (!stored.currentUserMessageEmitted) {
        writeSseEvent(reply.raw, {
          type: "conversation_message",
          runId: run.id,
          message: stored.currentUserMessage,
        });
        stored.currentUserMessageEmitted = true;
      }
      writeSseEvent(reply.raw, {
        type: "message_delta",
        runId: run.id,
        messageId: thinkingMessageId,
        text: isContinuation
          ? `已收到动作结果，并重新读取当前页面：${pageContext.title || pageContext.origin || "当前页面"}。正在调用 OpenAI ${model} 判断下一步。`
          : `已读取当前页面：${pageContext.title || pageContext.origin || "当前页面"}。正在调用 OpenAI ${model} 生成回答。`,
        channel: "thinking",
      });
      writeSseEvent(reply.raw, {
        type: "message_delta",
        runId: run.id,
        messageId: thinkingMessageId,
        text: "",
        channel: "thinking",
        done: true,
      });
      if (!isContinuation) {
        writeSseEvent(reply.raw, {
          type: "plan",
          runId: run.id,
          plan: createPlan(pageContext),
        });
      }
      setRunStatus(stored, "running");
      writeSseEvent(reply.raw, {
        type: "status",
        runId: run.id,
        status: "running",
      });

      try {
        await streamOpenAICompletion(reply.raw, stored, abortController);
      } catch (error) {
        if (abortController.signal.aborted) {
          setRunStatus(stored, "stopped");
          if (!clientClosed && !reply.raw.destroyed) {
            const doneMessageId = createScopedId("openai");
            writeAssistantDone(reply.raw, run.id, doneMessageId);
            writeSseEvent(reply.raw, {
              type: "status",
              runId: run.id,
              status: "stopped",
            });
          }
          return;
        }

        fastify.log.error(error);
        writeSseEvent(reply.raw, toErrorEvent(run.id, error));
        setRunStatus(stored, "failed");
        writeSseEvent(reply.raw, {
          type: "status",
          runId: run.id,
          status: "failed",
        });
      } finally {
        if (activeStreams.get(run.id)?.abortController === abortController) {
          activeStreams.delete(run.id);
        }
        if (!clientClosed && !reply.raw.destroyed) {
          writeSseDone(reply.raw);
          reply.raw.end();
        }
      }
    },
  );

  fastify.post<{ Params: { runId: string } }>(
    "/api/agent/runs/:runId/stop",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply, authStore);

      if (!user) {
        return reply;
      }

      const stored = runs.get(request.params.runId);

      if (!stored || stored.userId !== user.id) {
        return reply.code(404).send({
          error: {
            message: "Agent Run 不存在或服务已重启，请重新发起任务。",
          },
        });
      }

      activeStreams.get(request.params.runId)?.abortController.abort();
      setRunStatus(stored, "stopped");

      return {
        ok: true,
        status: stored.run.status,
      };
    },
  );
};
