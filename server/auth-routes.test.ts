import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthStore } from "./auth-store";
import { registerAuthRoutes } from "./auth-routes";
import { createDatabase } from "./db";

const tempDirs: string[] = [];

const createTestApp = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-routes-"));
  tempDirs.push(tempDir);
  const db = createDatabase(path.join(tempDir, "auth.sqlite"));
  const authStore = new AuthStore(db);
  const app = Fastify({ logger: false });

  registerAuthRoutes(app, authStore, {
    max: 2,
    timeWindow: "1 minute",
  });

  return { app, authStore };
};

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("auth route rate limits", () => {
  it("rate limits repeated login attempts", async () => {
    const { app, authStore } = createTestApp();
    await authStore.register("user@example.com", "password123");

    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "user@example.com",
          password: "wrong-password",
        },
      });

      expect(response.statusCode).toBe(401);
    }

    const limitedResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "user@example.com",
        password: "wrong-password",
      },
    });

    expect(limitedResponse.statusCode).toBe(429);
    expect(limitedResponse.json()).toMatchObject({
      error: {
        message: "请求过于频繁，请稍后再试。",
      },
    });
  });

  it("rate limits repeated registration attempts", async () => {
    const { app } = createTestApp();

    for (let index = 0; index < 2; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: `user-${index}@example.com`,
          password: "password123",
        },
      });

      expect(response.statusCode).toBe(200);
    }

    const limitedResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "user-limited@example.com",
        password: "password123",
      },
    });

    expect(limitedResponse.statusCode).toBe(429);
  });
});
