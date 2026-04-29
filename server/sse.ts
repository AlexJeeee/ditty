import { getModel, getOpenAIBaseUrl, getOpenAITimeoutMs } from "./config";
import type { AgentRunEvent } from "../src/shared/types";

export const writeSseEvent = (
  raw: NodeJS.WritableStream,
  event: AgentRunEvent,
) => {
  raw.write(`data: ${JSON.stringify(event)}\n\n`);
};

export const writeAssistantDone = (
  raw: NodeJS.WritableStream,
  runId: string,
  messageId: string,
) => {
  writeSseEvent(raw, {
    type: "message_delta",
    runId,
    messageId,
    text: "",
    channel: "answer",
    done: true,
  });
};

export const writeSseDone = (raw: NodeJS.WritableStream) => {
  raw.write("data: [DONE]\n\n");
};

export const toErrorEvent = (runId: string, error: unknown): AgentRunEvent => {
  const rawMessage =
    error instanceof Error ? error.message : "OpenAI 调用失败。";
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
        baseURL: getOpenAIBaseUrl(),
      },
    },
  };
};
