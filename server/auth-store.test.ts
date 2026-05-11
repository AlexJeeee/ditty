import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthStore } from "./auth-store";
import { createDatabase } from "./db";

const tempDirs: string[] = [];

const createTempStore = () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-store-"));
  tempDirs.push(tempDir);
  const db = createDatabase(path.join(tempDir, "auth.sqlite"));

  return {
    db,
    store: new AuthStore(db),
  };
};

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("AuthStore", () => {
  it("registers a user and resolves the issued session token", async () => {
    const { store } = createTempStore();

    const session = await store.register(" USER@example.com ", "password123");
    const resolvedUser = store.getUserByToken(session.accessToken);

    expect(session.user).toMatchObject({
      email: "user@example.com",
      quotaRemaining: 100,
    });
    expect(resolvedUser).toMatchObject({
      id: session.user.id,
      email: "user@example.com",
      quotaRemaining: 100,
    });
  });

  it("rejects duplicate email registration and wrong passwords", async () => {
    const { store } = createTempStore();

    await store.register("user@example.com", "password123");

    await expect(
      store.register("USER@example.com", "password123"),
    ).rejects.toThrow("邮箱已注册。");
    await expect(
      store.login("user@example.com", "bad-password"),
    ).rejects.toThrow("邮箱或密码不正确。");
  });

  it("logs in, logs out, and refuses logged out tokens", async () => {
    const { store } = createTempStore();

    await store.register("user@example.com", "password123");
    const session = await store.login("user@example.com", "password123");

    expect(store.getUserByToken(session.accessToken)?.email).toBe(
      "user@example.com",
    );

    store.logout(session.accessToken);

    expect(store.getUserByToken(session.accessToken)).toBeNull();
  });

  it("deducts quota and rejects users with no quota remaining", async () => {
    const { store } = createTempStore();
    const session = await store.register("user@example.com", "password123");

    expect(store.deductQuota(session.user.id)).toMatchObject({
      quotaRemaining: 99,
    });
    store.setQuota(session.user.id, 0);

    expect(() => store.deductQuota(session.user.id)).toThrow("额度不足。");
  });
});
