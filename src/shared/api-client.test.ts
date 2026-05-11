import { afterEach, describe, expect, it, vi } from "vitest";
import { listChatSessions, loginUser, setApiAccessToken } from "./api-client";

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
});
