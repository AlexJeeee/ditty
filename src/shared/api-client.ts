import type {
  AgentRun,
  AgentRunEvent,
  AuthCredentials,
  AuthSessionResponse,
  AuthUser,
  ChatSessionSnapshot,
  ChatSessionSummary,
  ModelConversationMessage,
  PageContext,
} from "./types";

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

const DEFAULT_AGENT_API_BASE_URL = "http://127.0.0.1:8787";
let accessToken = "";

export const setApiAccessToken = (token: string) => {
  accessToken = token;
};

const getApiBaseUrl = () => {
  return (
    import.meta.env.VITE_AGENT_API_BASE_URL || DEFAULT_AGENT_API_BASE_URL
  ).replace(/\/$/, "");
};

const readError = async (response: Response, fallback: string) => {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
};

const parseJsonResponse = async <T>(
  response: Response,
  fallback: string,
): Promise<T> => {
  if (!response.ok) {
    throw new Error(await readError(response, fallback));
  }

  return response.json() as Promise<T>;
};

const authHeaders = (): Record<string, string> => {
  if (!accessToken) {
    return {};
  }

  return {
    Authorization: `Bearer ${accessToken}`,
  };
};

const jsonHeaders = (authenticated = true): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(authenticated ? authHeaders() : {}),
});

const parseSseBlock = (block: string) => {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  return data || null;
};

async function* readSseEvents(
  response: Response,
): AsyncGenerator<AgentRunEvent> {
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

interface StreamAgentRunOptions extends AgentRequestOptions {
  conversation?: ModelConversationMessage[];
}

interface StopAgentRunResponse {
  ok: boolean;
  status: AgentRun["status"];
}

interface DeleteChatSessionResponse {
  ok: boolean;
  deleted: boolean;
}

export const createAgentRun = async (
  goal: string,
  pageContext: PageContext,
  conversation: ModelConversationMessage[],
  options?: AgentRequestOptions,
): Promise<AgentRun> => {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/agent/runs`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        goal,
        pageContext,
        conversation,
      }),
      signal: options?.signal,
    });

    return parseJsonResponse<AgentRun>(response, "Agent Run 创建失败。");
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Agent Run 创建失败。",
    );
  }
};

export async function* streamAgentRun(
  run: AgentRun,
  pageContext: PageContext,
  options?: StreamAgentRunOptions,
): AsyncGenerator<AgentRunEvent> {
  let response: Response;

  try {
    response = await fetch(
      `${getApiBaseUrl()}/api/agent/runs/${run.id}/stream`,
      {
        method: "POST",
        headers: {
          ...jsonHeaders(),
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          pageContext,
          ...(options?.conversation
            ? { conversation: options.conversation }
            : {}),
        }),
        signal: options?.signal,
      },
    );
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Agent 流式连接失败，请确认本地代理服务已启动。",
    );
  }

  yield* readSseEvents(response);
}

export const stopAgentRun = async (
  runId: string,
): Promise<StopAgentRunResponse> => {
  const response = await fetch(
    `${getApiBaseUrl()}/api/agent/runs/${runId}/stop`,
    {
      method: "POST",
      headers: authHeaders(),
    },
  );

  return parseJsonResponse<StopAgentRunResponse>(
    response,
    "Agent Run 停止失败。",
  );
};

export const listChatSessions = async (): Promise<ChatSessionSummary[]> => {
  const response = await fetch(`${getApiBaseUrl()}/api/chat/sessions`, {
    headers: authHeaders(),
  });

  return parseJsonResponse<ChatSessionSummary[]>(
    response,
    "历史聊天读取失败。",
  );
};

export const getChatSession = async (
  sessionId: string,
): Promise<ChatSessionSnapshot> => {
  const response = await fetch(
    `${getApiBaseUrl()}/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: authHeaders(),
    },
  );

  return parseJsonResponse<ChatSessionSnapshot>(response, "历史聊天读取失败。");
};

export const saveChatSession = async (
  snapshot: ChatSessionSnapshot,
): Promise<ChatSessionSnapshot> => {
  const response = await fetch(
    `${getApiBaseUrl()}/api/chat/sessions/${encodeURIComponent(snapshot.id)}`,
    {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ snapshot }),
    },
  );

  return parseJsonResponse<ChatSessionSnapshot>(response, "历史聊天保存失败。");
};

export const deleteChatSession = async (
  sessionId: string,
): Promise<DeleteChatSessionResponse> => {
  const response = await fetch(
    `${getApiBaseUrl()}/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );

  return parseJsonResponse<DeleteChatSessionResponse>(
    response,
    "历史聊天删除失败。",
  );
};

export const registerUser = async (
  credentials: AuthCredentials,
): Promise<AuthSessionResponse> => {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/register`, {
    method: "POST",
    headers: jsonHeaders(false),
    body: JSON.stringify(credentials),
  });

  return parseJsonResponse<AuthSessionResponse>(response, "注册失败。");
};

export const loginUser = async (
  credentials: AuthCredentials,
): Promise<AuthSessionResponse> => {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
    method: "POST",
    headers: jsonHeaders(false),
    body: JSON.stringify(credentials),
  });

  return parseJsonResponse<AuthSessionResponse>(response, "邮箱或密码不正确。");
};

export const getCurrentUser = async (): Promise<AuthUser> => {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
    headers: authHeaders(),
  });

  return parseJsonResponse<AuthUser>(response, "请重新登录。");
};

export const logoutUser = async (): Promise<{ ok: boolean }> => {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
    method: "POST",
    headers: authHeaders(),
  });

  return parseJsonResponse<{ ok: boolean }>(response, "退出登录失败。");
};
