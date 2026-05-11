import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultModelRoute, getModelProviders } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("model provider config", () => {
  it("parses provider registry from AI_MODEL_PROVIDERS_JSON", () => {
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
    vi.stubEnv("AI_DEFAULT_PROVIDER", "deepseek");
    vi.stubEnv("AI_DEFAULT_MODEL", "deepseek-chat");

    expect(getModelProviders()).toEqual([
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
    ]);
    expect(getDefaultModelRoute()).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-chat",
    });
  });

  it("falls back to legacy OPENAI env when provider JSON is absent", () => {
    vi.stubEnv("OPENAI_MODEL", "MiniMax-M2.7");
    vi.stubEnv("OPENAI_BASE_URL", "https://api.minimaxi.com/v1");

    expect(getModelProviders()).toEqual([
      {
        id: "openai",
        name: "OpenAI Compatible",
        baseURL: "https://api.minimaxi.com/v1",
        apiKeyEnv: "OPENAI_API_KEY",
        models: [{ id: "MiniMax-M2.7", name: "MiniMax-M2.7" }],
      },
    ]);
    expect(getDefaultModelRoute()).toEqual({
      providerId: "openai",
      modelId: "MiniMax-M2.7",
    });
  });
});
