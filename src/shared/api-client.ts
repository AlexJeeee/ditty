import type { AgentRun, AgentRunEvent, PageContext } from "./types";

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

const DEFAULT_AGENT_API_BASE_URL = "http://127.0.0.1:8787";

function getApiBaseUrl() {
  return (import.meta.env.VITE_AGENT_API_BASE_URL || DEFAULT_AGENT_API_BASE_URL).replace(/\/$/, "");
}

async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
}

async function parseJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }

  return response.json() as Promise<T>;
}

function parseSseBlock(block: string) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  return data || null;
}

async function* readSseEvents(response: Response): AsyncGenerator<AgentRunEvent> {
  if (!response.ok || !response.body) {
    throw new Error(await readError(response, "Agent 流式连接失败。"));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const data = parseSseBlock(block);

      if (!data) {
        continue;
      }

      if (data === "[DONE]") {
        return;
      }

      yield JSON.parse(data) as AgentRunEvent;
    }
  }

  buffer += decoder.decode();
  const data = parseSseBlock(buffer);

  if (data && data !== "[DONE]") {
    yield JSON.parse(data) as AgentRunEvent;
  }
}

interface AgentRequestOptions {
  signal?: AbortSignal;
}

interface StopAgentRunResponse {
  ok: boolean;
  status: AgentRun["status"];
}

export async function createAgentRun(goal: string, pageContext: PageContext, options?: AgentRequestOptions): Promise<AgentRun> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/agent/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        goal,
        pageContext
      }),
      signal: options?.signal
    });

    return parseJsonResponse<AgentRun>(response, "Agent Run 创建失败。");
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Agent Run 创建失败。");
  }
}

export async function* streamAgentRun(run: AgentRun, pageContext: PageContext, options?: AgentRequestOptions): AsyncGenerator<AgentRunEvent> {
  let response: Response;

  try {
    response = await fetch(`${getApiBaseUrl()}/api/agent/runs/${run.id}/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({
        pageContext
      }),
      signal: options?.signal
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Agent 流式连接失败，请确认本地代理服务已启动。");
  }

  yield* readSseEvents(response);
}

export async function stopAgentRun(runId: string): Promise<StopAgentRunResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/agent/runs/${runId}/stop`, {
    method: "POST"
  });

  return parseJsonResponse<StopAgentRunResponse>(response, "Agent Run 停止失败。");
}
