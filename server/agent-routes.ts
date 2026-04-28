import type { FastifyInstance } from "fastify";
import { getModel, getOpenAIBaseUrl, getOpenAITimeoutMs, requireOpenAIClient } from "./config";
import { buildPrompt, createPlan } from "./agent-prompt";
import {
  accumulateToolCalls,
  createActionFromToolCall,
  hasModelToolDefinition,
  MODEL_CHAT_TOOLS,
  type ToolCallAccumulator
} from "./model-tools";
import { activeStreams, runs, setRunStatus, validatePageContext } from "./run-store";
import { toErrorEvent, writeAssistantDone, writeSseDone, writeSseEvent } from "./sse";
import { createScopedId } from "../src/shared/id";
import type { AgentRun, PageContext } from "../src/shared/types";

interface CreateAgentRunBody {
  goal?: string;
  pageContext?: PageContext;
}

interface StreamAgentRunBody {
  pageContext?: PageContext;
}

export function registerAgentRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => ({
    ok: true,
    model: getModel(),
    openaiTimeoutMs: getOpenAITimeoutMs()
  }));

  fastify.get("/health/openai", async (_request, reply) => {
    try {
      const startedAt = Date.now();
      const openai = requireOpenAIClient();
      await openai.models.list();

      return {
        ok: true,
        model: getModel(),
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        error: {
          message: error instanceof Error ? error.message : "OpenAI API 不可达。",
          timeoutMs: getOpenAITimeoutMs(),
          baseURL: getOpenAIBaseUrl()
        }
      });
    }
  });

  fastify.post<{ Body: CreateAgentRunBody }>("/api/agent/runs", async (request, reply) => {
    try {
      const goal = request.body?.goal?.trim();

      if (!goal) {
        return reply.code(400).send({
          error: {
            message: "goal 不能为空。"
          }
        });
      }

      const pageContext = validatePageContext(request.body?.pageContext);
      const now = new Date().toISOString();
      const run: AgentRun = {
        id: createScopedId("run"),
        status: "created",
        goal,
        pageUrl: pageContext.url,
        pageTitle: pageContext.title,
        createdAt: now,
        updatedAt: now
      };

      runs.set(run.id, {
        run,
        goal,
        pageContext
      });

      return run;
    } catch (error) {
      return reply.code(400).send({
        error: {
          message: error instanceof Error ? error.message : "创建 Agent Run 失败。"
        }
      });
    }
  });

  fastify.post<{ Params: { runId: string }; Body: StreamAgentRunBody }>("/api/agent/runs/:runId/stream", async (request, reply) => {
    const stored = runs.get(request.params.runId);

    if (!stored) {
      return reply.code(404).send({
        error: {
          message: "Agent Run 不存在或服务已重启，请重新发起任务。"
        }
      });
    }

    const pageContext = request.body?.pageContext ? validatePageContext(request.body.pageContext) : stored.pageContext;
    const { run, goal } = stored;
    const messageId = createScopedId("openai");
    const model = getModel();
    const abortController = new AbortController();
    let clientClosed = false;

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
      "X-Accel-Buffering": "no"
    });
    reply.raw.flushHeaders?.();

    setRunStatus(stored, "planning");
    writeSseEvent(reply.raw, { type: "status", runId: run.id, status: "planning" });
    const thinkingMessageId = createScopedId("thinking");
    writeSseEvent(reply.raw, {
      type: "message_delta",
      runId: run.id,
      messageId: thinkingMessageId,
      text: `已读取当前页面：${pageContext.title || pageContext.origin || "当前页面"}。正在调用 OpenAI ${model} 生成回答。`,
      channel: "thinking"
    });
    writeSseEvent(reply.raw, {
      type: "message_delta",
      runId: run.id,
      messageId: thinkingMessageId,
      text: "",
      channel: "thinking",
      done: true
    });
    writeSseEvent(reply.raw, { type: "plan", runId: run.id, plan: createPlan(pageContext) });
    setRunStatus(stored, "running");
    writeSseEvent(reply.raw, { type: "status", runId: run.id, status: "running" });

    try {
      const openai = requireOpenAIClient();
      const toolCalls: ToolCallAccumulator[] = [];
      let hasAnswerText = false;
      const stream = await openai.chat.completions.create(
        {
          model,
          messages: [
            {
              role: "system",
              content:
                "你是一个运行在 Chrome 侧边栏里的网页 AI 助手。请用中文回答，优先结合用户任务和网页上下文。你可以在用户明确要求或任务确实需要时调用可用工具。工具调用只会生成待确认动作，不会立即执行；不要声称你已经打开、点击、填写或修改了网页。如果工具参数不确定，请不要猜测，改为向用户说明缺口。"
            },
            {
              role: "user",
              content: buildPrompt(goal, pageContext)
            }
          ],
          tools: MODEL_CHAT_TOOLS,
          tool_choice: "auto",
          parallel_tool_calls: false,
          stream: true
        },
        {
          signal: abortController.signal
        }
      );

      for await (const chunk of stream) {
        const choiceDelta = chunk.choices[0]?.delta;
        const delta = choiceDelta?.content;

        if (typeof delta === "string" && delta.length > 0) {
          hasAnswerText = true;
          writeSseEvent(reply.raw, {
            type: "message_delta",
            runId: run.id,
            messageId,
            text: delta,
            channel: "answer"
          });
        }

        if (choiceDelta?.tool_calls?.length) {
          accumulateToolCalls(toolCalls, choiceDelta.tool_calls);
        }
      }

      if (hasAnswerText) {
        writeAssistantDone(reply.raw, run.id, messageId);
      }

      const requestedToolCall = toolCalls.find((toolCall) => hasModelToolDefinition(toolCall.name)) ?? toolCalls[0];

      if (requestedToolCall) {
        const { action, blockedReason } = createActionFromToolCall(requestedToolCall, createScopedId("action"));

        if (action) {
          if (!hasAnswerText) {
            writeSseEvent(reply.raw, {
              type: "message_delta",
              runId: run.id,
              messageId,
              text: action.requiresConfirmation
                ? "我已准备好一个需要确认的动作，请确认后我再执行。"
                : "我已准备好一个安全动作，会直接执行并返回结果。",
              channel: "answer"
            });
            writeAssistantDone(reply.raw, run.id, messageId);
          }

          writeSseEvent(reply.raw, { type: "action_request", runId: run.id, action });
          if (action.requiresConfirmation) {
            setRunStatus(stored, "requires_confirmation");
            writeSseEvent(reply.raw, { type: "status", runId: run.id, status: "requires_confirmation" });
          }
        } else {
          writeSseEvent(reply.raw, {
            type: "message_delta",
            runId: run.id,
            messageId,
            text: blockedReason || "模型请求的工具动作未通过本地校验。",
            channel: "answer"
          });
          writeAssistantDone(reply.raw, run.id, messageId);
          setRunStatus(stored, "blocked");
          writeSseEvent(reply.raw, { type: "status", runId: run.id, status: "blocked" });
        }
      } else {
        if (!hasAnswerText) {
          writeSseEvent(reply.raw, {
            type: "message_delta",
            runId: run.id,
            messageId,
            text: "我没有找到需要执行的新动作，会继续停留在当前页面对话。",
            channel: "answer"
          });
          writeAssistantDone(reply.raw, run.id, messageId);
        }

        setRunStatus(stored, "completed");
        writeSseEvent(reply.raw, { type: "status", runId: run.id, status: "completed" });
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setRunStatus(stored, "stopped");
        if (!clientClosed && !reply.raw.destroyed) {
          writeAssistantDone(reply.raw, run.id, messageId);
          writeSseEvent(reply.raw, { type: "status", runId: run.id, status: "stopped" });
        }
        return;
      }

      fastify.log.error(error);
      writeSseEvent(reply.raw, toErrorEvent(run.id, error));
      setRunStatus(stored, "failed");
      writeSseEvent(reply.raw, { type: "status", runId: run.id, status: "failed" });
    } finally {
      if (activeStreams.get(run.id)?.abortController === abortController) {
        activeStreams.delete(run.id);
      }
      if (!clientClosed && !reply.raw.destroyed) {
        writeSseDone(reply.raw);
        reply.raw.end();
      }
    }
  });

  fastify.post<{ Params: { runId: string } }>("/api/agent/runs/:runId/stop", async (request, reply) => {
    const stored = runs.get(request.params.runId);

    if (!stored) {
      return reply.code(404).send({
        error: {
          message: "Agent Run 不存在或服务已重启，请重新发起任务。"
        }
      });
    }

    activeStreams.get(request.params.runId)?.abortController.abort();
    setRunStatus(stored, "stopped");

    return {
      ok: true,
      status: stored.run.status
    };
  });
}
