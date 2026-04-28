import cors from "@fastify/cors";
import "dotenv/config";
import Fastify from "fastify";
import OpenAI from "openai";
import {
  accumulateToolCalls,
  createActionFromToolCall,
  hasModelToolDefinition,
  MODEL_CHAT_TOOLS,
  MODEL_TOOL_PLAN_STEPS,
  type ToolCallAccumulator
} from "./model-tools";
import type { AgentAction, AgentPlan, AgentRun, AgentRunEvent, PageContext } from "../src/shared/types";

interface CreateAgentRunBody {
  goal?: string;
  pageContext?: PageContext;
}

interface StreamAgentRunBody {
  pageContext?: PageContext;
}

interface StoredRun {
  run: AgentRun;
  goal: string;
  pageContext: PageContext;
}

interface ActiveStream {
  abortController: AbortController;
}

const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_PORT = 8787;
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_MAX_RETRIES = 1;
const MAX_VISIBLE_TEXT_LENGTH = 6000;
const MAX_SELECTED_TEXT_LENGTH = 4000;
const MAX_ELEMENT_COUNT = 20;
const runs = new Map<string, StoredRun>();
const activeStreams = new Map<string, ActiveStream>();

const fastify = Fastify({
  logger: true
});

await fastify.register(cors, {
  origin: true
});

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getPort() {
  const parsed = Number(process.env.AI_AGENT_PORT ?? DEFAULT_PORT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function getModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function getOpenAITimeoutMs() {
  const parsed = Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_OPENAI_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_OPENAI_TIMEOUT_MS;
}

function getOpenAIMaxRetries() {
  const parsed = Number(process.env.OPENAI_MAX_RETRIES ?? DEFAULT_OPENAI_MAX_RETRIES);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_OPENAI_MAX_RETRIES;
}

function requireOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 未配置，请在本地 .env 中设置后重启 server。");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: getOpenAITimeoutMs(),
    maxRetries: getOpenAIMaxRetries()
  });
}

function truncate(value: string | undefined, maxLength: number) {
  if (!value) {
    return "";
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

function validatePageContext(value: unknown): PageContext {
  if (!value || typeof value !== "object") {
    throw new Error("pageContext 缺失。");
  }

  const pageContext = value as PageContext;

  if (typeof pageContext.url !== "string" || typeof pageContext.title !== "string") {
    throw new Error("pageContext 格式不正确。");
  }

  return {
    ...pageContext,
    selectedText: truncate(pageContext.selectedText, MAX_SELECTED_TEXT_LENGTH),
    visibleTextSummary: truncate(pageContext.visibleTextSummary, MAX_VISIBLE_TEXT_LENGTH),
    interactiveElements: (pageContext.interactiveElements ?? []).slice(0, MAX_ELEMENT_COUNT)
  };
}

function createPlan(pageContext: PageContext): AgentPlan {
  const steps: AgentAction[] = [
    {
      id: createId("action"),
      toolName: "read_page",
      riskLevel: "low",
      requiresConfirmation: false,
      reason: `读取当前页面标题、URL、选区和可见文本摘要：${pageContext.title || pageContext.origin || "当前页面"}。`
    },
    {
      id: createId("action"),
      toolName: "summarize_selection",
      riskLevel: "low",
      requiresConfirmation: false,
      input: {
        text: pageContext.selectedText || pageContext.visibleTextSummary.slice(0, 240)
      },
      reason: pageContext.selectedText ? "优先结合用户选中的网页文本回答。" : "未检测到选区，结合页面可见内容摘要回答。"
    },
    ...MODEL_TOOL_PLAN_STEPS.map((step) => ({
      ...step,
      id: createId("action")
    }))
  ];

  return {
    summary: "已接入 OpenAI 真实模型。模型可以请求打开网页，但必须先生成白名单工具动作并等待你确认。",
    steps,
    blockedActions: []
  };
}

function buildPrompt(goal: string, pageContext: PageContext) {
  const elements = pageContext.interactiveElements
    .map((element, index) => {
      const label = element.label || element.placeholder || element.valuePreview || element.role;
      return `${index + 1}. ${element.role} ${label ? `- ${label}` : ""} [risk=${element.riskLevel}]`;
    })
    .join("\n");

  return [
    `用户任务：${goal}`,
    "",
    "当前网页上下文：",
    `标题：${pageContext.title || "(无标题)"}`,
    `URL：${pageContext.url}`,
    `来源：${pageContext.origin || "(未知)"}`,
    `采集时间：${pageContext.collectedAt || "(未知)"}`,
    "",
    "选中文本：",
    pageContext.selectedText || "(无)",
    "",
    "页面可见文本摘要：",
    pageContext.visibleTextSummary || "(无)",
    "",
    "页面标题结构：",
    pageContext.headings.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`).join("\n") || "(无)",
    "",
    "可交互元素摘要：",
    elements || "(无)"
  ].join("\n");
}

function writeAssistantDone(raw: NodeJS.WritableStream, runId: string, messageId: string) {
  writeSseEvent(raw, {
    type: "message_delta",
    runId,
    messageId,
    text: "",
    channel: "answer",
    done: true
  });
}

function writeSseEvent(raw: NodeJS.WritableStream, event: AgentRunEvent) {
  raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeSseDone(raw: NodeJS.WritableStream) {
  raw.write("data: [DONE]\n\n");
}

function toErrorEvent(runId: string, error: unknown): AgentRunEvent {
  const rawMessage = error instanceof Error ? error.message : "OpenAI 调用失败。";
  const isTimeout = /timed out|timeout/i.test(rawMessage);

  return {
    type: "error",
    runId,
    error: {
      code: "NETWORK_ERROR",
      message: isTimeout
        ? `OpenAI API 请求超时。请确认当前网络能访问 api.openai.com，或在 .env 中配置 OPENAI_BASE_URL / OPENAI_TIMEOUT_MS 后重启 server。原始错误：${rawMessage}`
        : rawMessage,
      retryable: true,
      details: {
        model: getModel(),
        timeoutMs: getOpenAITimeoutMs(),
        baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
      }
    }
  };
}

function setRunStatus(stored: StoredRun, status: AgentRun["status"]) {
  stored.run.status = status;
  stored.run.updatedAt = new Date().toISOString();
}

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
        baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
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
      id: createId("run"),
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
  const messageId = createId("openai");
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
  const thinkingMessageId = createId("thinking");
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
    const stream = await openai.chat.completions.create({
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
    }, {
      signal: abortController.signal
    });

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

    const requestedToolCall =
      toolCalls.find((toolCall) => hasModelToolDefinition(toolCall.name)) ?? toolCalls[0];

    if (requestedToolCall) {
      const { action, blockedReason } = createActionFromToolCall(requestedToolCall, createId("action"));

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

const port = getPort();

try {
  await fastify.listen({
    host: "127.0.0.1",
    port
  });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}
