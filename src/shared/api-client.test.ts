import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRun,
  listChatSessions,
  listModels,
  loginUser,
  setApiAccessToken,
} from "./api-client";
import type { PageContext } from "./types";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

afterEach(() => {
  vi.restoreAllMocks();
  setApiAccessToken("");
});

describe("api-client auth headers", () => {
  it("does not attach bearer tokens to login requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        accessToken: "new-token",
        user: {
          id: "user_1",
          email: "user@example.com",
          quotaRemaining: 100,
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      }),
    );
    setApiAccessToken("old-token");

    await loginUser({
      email: "user@example.com",
      password: "password123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/login"),
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it("attaches bearer tokens to authenticated API requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse([]));
    setApiAccessToken("session-token");

    await listChatSessions();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/chat/sessions"),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer session-token",
        },
      }),
    );
  });

  it("reads model provider metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        defaultRoute: {
          providerId: "minmax",
          modelId: "MiniMax-M2.7",
        },
        providers: [
          {
            id: "minmax",
            name: "MiniMax",
            models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
          },
        ],
      }),
    );

    await expect(listModels()).resolves.toEqual({
      defaultRoute: {
        providerId: "minmax",
        modelId: "MiniMax-M2.7",
      },
      providers: [
        {
          id: "minmax",
          name: "MiniMax",
          models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/models"),
      expect.objectContaining({
        headers: {},
      }),
    );
  });

  it("sends the selected model route when creating an agent run", async () => {
    const pageContext: PageContext = {
      url: "https://example.com",
      origin: "https://example.com",
      title: "Example",
      selectedText: "",
      visibleTextSummary: "Example page",
      headings: [],
      tables: [],
      interactiveElements: [],
      collectedAt: "2026-05-11T00:00:00.000Z",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        id: "run_1",
        status: "created",
        goal: "总结页面",
        pageUrl: "https://example.com",
        pageTitle: "Example",
        modelRoute: {
          providerId: "deepseek",
          modelId: "deepseek-chat",
        },
        createdAt: "2026-05-11T00:00:00.000Z",
        updatedAt: "2026-05-11T00:00:00.000Z",
      }),
    );

    await createAgentRun("总结页面", pageContext, [], {
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/agent/runs"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          goal: "总结页面",
          pageContext,
          conversation: [],
          modelRoute: {
            providerId: "deepseek",
            modelId: "deepseek-chat",
          },
        }),
      }),
    );
  });
});
