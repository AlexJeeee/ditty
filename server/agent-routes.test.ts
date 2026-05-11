import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthStore } from "./auth-store";
import { ChatHistoryStore } from "./chat-history-store";
import { createDatabase } from "./db";
import { registerAgentRoutes } from "./agent-routes";
import { registerAuthRoutes } from "./auth-routes";
import { RunStore, runs } from "./run-store";
import type { PageContext } from "../src/shared/types";

const tempDirs: string[] = [];

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

const createTestApp = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-routes-"));
  tempDirs.push(tempDir);
  const db = createDatabase(path.join(tempDir, "agent.sqlite"));
  const authStore = new AuthStore(db);
  const runStore = new RunStore(db);
  const app = Fastify({ logger: false });

  registerAuthRoutes(app, authStore);
  registerAgentRoutes(app, {
    authStore,
    chatHistoryStore: new ChatHistoryStore(db),
    runStore,
  });

  return { app, authStore, db, runStore };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("agent auth routes", () => {
  it("returns model provider metadata without leaking provider secrets", async () => {
    vi.stubEnv(
      "AI_MODEL_PROVIDERS_JSON",
      JSON.stringify([
        {
          id: "minmax",
          name: "MiniMax",
          baseURL: "https://api.minimaxi.com/v1",
          apiKeyEnv: "MINIMAX_API_KEY",
          models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
        },
        {
          id: "deepseek",
          name: "DeepSeek",
          baseURL: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
        },
      ]),
    );
    vi.stubEnv("AI_DEFAULT_PROVIDER", "minmax");
    vi.stubEnv("AI_DEFAULT_MODEL", "MiniMax-M2.7");
    vi.stubEnv("MINIMAX_API_KEY", "secret-minmax");
    const { app } = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/models",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
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
        {
          id: "deepseek",
          name: "DeepSeek",
          models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
        },
      ],
    });
    expect(response.body).not.toContain("baseURL");
    expect(response.body).not.toContain("apiKeyEnv");
    expect(response.body).not.toContain("secret-minmax");
  });

  it("requires authentication before creating an agent run", async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      payload: {
        goal: "总结页面",
        pageContext,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        message: "请重新登录。",
      },
    });
  });

  it("deducts one quota when an authenticated user creates an agent run", async () => {
    const { app, authStore } = createTestApp();
    const auth = await authStore.register("user@example.com", "password123");

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(authStore.getUserByToken(auth.accessToken)?.quotaRemaining).toBe(99);
  });

  it("stores the requested model route when creating an agent run", async () => {
    vi.stubEnv(
      "AI_MODEL_PROVIDERS_JSON",
      JSON.stringify([
        {
          id: "minmax",
          name: "MiniMax",
          baseURL: "https://api.minimaxi.com/v1",
          apiKeyEnv: "MINIMAX_API_KEY",
          models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
        },
        {
          id: "deepseek",
          name: "DeepSeek",
          baseURL: "https://api.deepseek.com/v1",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }],
        },
      ]),
    );
    const { app, authStore, runStore } = createTestApp();
    const auth = await authStore.register("user@example.com", "password123");

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
        modelRoute: {
          providerId: "deepseek",
          modelId: "deepseek-chat",
        },
      },
    });
    const run = response.json() as { id: string };

    expect(response.statusCode).toBe(200);
    expect(runStore.get(run.id)?.run.modelRoute).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
  });

  it("rejects unknown model routes without deducting quota", async () => {
    vi.stubEnv(
      "AI_MODEL_PROVIDERS_JSON",
      JSON.stringify([
        {
          id: "minmax",
          name: "MiniMax",
          baseURL: "https://api.minimaxi.com/v1",
          apiKeyEnv: "MINIMAX_API_KEY",
          models: [{ id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
        },
      ]),
    );
    const { app, authStore } = createTestApp();
    const auth = await authStore.register("user@example.com", "password123");

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
        modelRoute: {
          providerId: "deepseek",
          modelId: "deepseek-chat",
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        message: "模型提供商不可用：deepseek。",
      },
    });
    expect(authStore.getUserByToken(auth.accessToken)?.quotaRemaining).toBe(
      100,
    );
  });

  it("rejects agent runs when quota is exhausted", async () => {
    const { app, authStore } = createTestApp();
    const auth = await authStore.register("user@example.com", "password123");
    authStore.setQuota(auth.user.id, 0);

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        message: "额度不足。",
      },
    });
  });

  it("does not deduct quota when agent run storage fails", async () => {
    const { app, authStore, db, runStore } = createTestApp();
    const auth = await authStore.register("user@example.com", "password123");
    vi.spyOn(runStore, "set").mockImplementation(() => {
      throw new Error("run storage failed");
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(authStore.getUserByToken(auth.accessToken)?.quotaRemaining).toBe(
      100,
    );
  });

  it("prevents one user from stopping another user's agent run", async () => {
    const { app, authStore } = createTestApp();
    const firstUser = await authStore.register("a@example.com", "password123");
    const secondUser = await authStore.register("b@example.com", "password123");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${firstUser.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
      },
    });
    const run = createResponse.json() as { id: string };
    const stopResponse = await app.inject({
      method: "POST",
      url: `/api/agent/runs/${run.id}/stop`,
      headers: {
        authorization: `Bearer ${secondUser.accessToken}`,
      },
    });

    expect(stopResponse.statusCode).toBe(404);
    expect(stopResponse.json()).toMatchObject({
      error: {
        message: "Agent Run 不存在或服务已重启，请重新发起任务。",
      },
    });
  });

  it("recovers a created run after the in-memory cache is recreated", async () => {
    const { app, authStore, db, runStore } = createTestApp();
    const auth = await authStore.register("user@example.com", "password123");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
      },
    });
    const run = createResponse.json() as { id: string };

    expect(new RunStore(db).get(run.id)).toMatchObject({
      run: {
        id: run.id,
        status: "created",
      },
      userId: auth.user.id,
    });

    runStore.clearMemory();
    expect(runStore.get(run.id)).toMatchObject({
      run: {
        id: run.id,
        status: "created",
      },
      userId: auth.user.id,
    });
  });

  it("can stop a recovered run instead of reporting a service restart", async () => {
    const { app, authStore, db, runStore } = createTestApp();
    const auth = await authStore.register("user@example.com", "password123");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/agent/runs",
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
      payload: {
        goal: "总结页面",
        pageContext,
      },
    });
    const run = createResponse.json() as { id: string };

    runStore.clearMemory();

    const stopResponse = await app.inject({
      method: "POST",
      url: `/api/agent/runs/${run.id}/stop`,
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
      },
    });

    expect(stopResponse.statusCode).toBe(200);
    expect(stopResponse.json()).toMatchObject({
      ok: true,
      status: "stopped",
    });
    expect(new RunStore(db).get(run.id)?.run.status).toBe("stopped");
  });
});
