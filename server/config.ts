import OpenAI from "openai";
import path from "node:path";
import type { ModelInfo, ModelProvider, ModelRoute } from "../src/shared/types";

const DEFAULT_MODEL = "gpt-5.2";
const LEGACY_PROVIDER_ID = "openai";
const LEGACY_PROVIDER_NAME = "OpenAI Compatible";
const DEFAULT_PORT = 8787;
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_MAX_RETRIES = 1;
const DEFAULT_DB_PATH = path.resolve("server/.data/chat-history.sqlite");

export interface ServerModelProvider extends ModelProvider {
  baseURL: string;
  apiKeyEnv: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const normalizeModel = (value: unknown): ModelInfo | null => {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const id = value.id.trim();
  const name = typeof value.name === "string" ? value.name.trim() : id;

  if (!id) {
    return null;
  }

  return {
    id,
    name: name || id,
  };
};

const normalizeProvider = (value: unknown): ServerModelProvider | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.baseURL !== "string" ||
    typeof value.apiKeyEnv !== "string" ||
    !Array.isArray(value.models)
  ) {
    return null;
  }

  const id = value.id.trim();
  const name = value.name.trim();
  const baseURL = value.baseURL.trim();
  const apiKeyEnv = value.apiKeyEnv.trim();
  const models = value.models
    .map(normalizeModel)
    .filter((model): model is ModelInfo => Boolean(model));

  if (!id || !name || !baseURL || !apiKeyEnv || !models.length) {
    return null;
  }

  return {
    id,
    name,
    baseURL,
    apiKeyEnv,
    models,
  };
};

const createLegacyProvider = (): ServerModelProvider => {
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  return {
    id: LEGACY_PROVIDER_ID,
    name: LEGACY_PROVIDER_NAME,
    baseURL: getOpenAIBaseUrl(),
    apiKeyEnv: "OPENAI_API_KEY",
    models: [
      {
        id: model,
        name: model,
      },
    ],
  };
};

export const getPort = () => {
  const parsed = Number(process.env.AI_AGENT_PORT ?? DEFAULT_PORT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
};

export const getModel = () => {
  return getDefaultModelRoute().modelId;
};

export const getOpenAITimeoutMs = () => {
  const parsed = Number(
    process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_OPENAI_TIMEOUT_MS,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_OPENAI_TIMEOUT_MS;
};

export const getOpenAIMaxRetries = () => {
  const parsed = Number(
    process.env.OPENAI_MAX_RETRIES ?? DEFAULT_OPENAI_MAX_RETRIES,
  );
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_OPENAI_MAX_RETRIES;
};

export const getOpenAIBaseUrl = () => {
  return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
};

export const getDatabasePath = () => {
  return path.resolve(process.env.AI_AGENT_DB_PATH || DEFAULT_DB_PATH);
};

export const getModelProviders = (): ServerModelProvider[] => {
  const raw = process.env.AI_MODEL_PROVIDERS_JSON?.trim();

  if (!raw) {
    return [createLegacyProvider()];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI_MODEL_PROVIDERS_JSON 不是合法 JSON。");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI_MODEL_PROVIDERS_JSON 必须是数组。");
  }

  const providers = parsed
    .map(normalizeProvider)
    .filter((provider): provider is ServerModelProvider => Boolean(provider));

  if (!providers.length) {
    throw new Error("AI_MODEL_PROVIDERS_JSON 未配置可用模型提供商。");
  }

  return providers;
};

export const getDefaultModelRoute = (): ModelRoute => {
  const providers = getModelProviders();
  const requestedProviderId =
    process.env.AI_DEFAULT_PROVIDER?.trim() || providers[0].id;
  const provider =
    providers.find((item) => item.id === requestedProviderId) ?? providers[0];
  const requestedModelId =
    process.env.AI_DEFAULT_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    provider.models[0].id;
  const model =
    provider.models.find((item) => item.id === requestedModelId) ??
    provider.models[0];

  return {
    providerId: provider.id,
    modelId: model.id,
  };
};

export const resolveModelRoute = (value?: unknown): ModelRoute => {
  if (value === undefined || value === null) {
    return getDefaultModelRoute();
  }

  if (
    !isRecord(value) ||
    typeof value.providerId !== "string" ||
    typeof value.modelId !== "string"
  ) {
    throw new Error("模型路由格式不正确。");
  }

  const providerId = value.providerId.trim();
  const modelId = value.modelId.trim();
  const provider = getModelProviders().find((item) => item.id === providerId);

  if (!provider) {
    throw new Error(`模型提供商不可用：${providerId}。`);
  }

  if (!provider.models.some((model) => model.id === modelId)) {
    throw new Error(`模型不可用：${modelId}。`);
  }

  return {
    providerId,
    modelId,
  };
};

export const getPublicModelsResponse = () => {
  const providers = getModelProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: provider.models,
  }));

  return {
    defaultRoute: getDefaultModelRoute(),
    providers,
  };
};

export const findProviderForRoute = (route: ModelRoute) => {
  const provider = getModelProviders().find(
    (item) => item.id === route.providerId,
  );

  if (!provider) {
    throw new Error(`模型提供商不可用：${route.providerId}。`);
  }

  return provider;
};

const openaiClients = new Map<string, OpenAI>();

export const requireOpenAIClient = (route = getDefaultModelRoute()): OpenAI => {
  const provider = findProviderForRoute(route);
  const apiKey = process.env[provider.apiKeyEnv];

  if (!apiKey) {
    throw new Error(
      `${provider.apiKeyEnv} 未配置，请在本地 .env 中设置后重启 server。`,
    );
  }

  const cacheKey = `${provider.id}:${provider.baseURL}:${provider.apiKeyEnv}:${apiKey}`;
  const cached = openaiClients.get(cacheKey);

  if (cached) {
    return cached;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseURL || undefined,
    timeout: getOpenAITimeoutMs(),
    maxRetries: getOpenAIMaxRetries(),
  });
  openaiClients.set(cacheKey, client);

  return client;
};
