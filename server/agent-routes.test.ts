import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthStore } from "./auth-store";
import { ChatHistoryStore } from "./chat-history-store";
import { createDatabase } from "./db";
import { registerAgentRoutes } from "./agent-routes";
import { registerAuthRoutes } from "./auth-routes";
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
  const app = Fastify({ logger: false });

  registerAuthRoutes(app, authStore);
  registerAgentRoutes(app, {
    authStore,
    chatHistoryStore: new ChatHistoryStore(db),
  });

  return { app, authStore };
};

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("agent auth routes", () => {
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
});
