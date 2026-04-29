import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_PORT = 8787;
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_MAX_RETRIES = 1;

export const getPort = () => {
  const parsed = Number(process.env.AI_AGENT_PORT ?? DEFAULT_PORT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
};

export const getModel = () => {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
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

let _openaiClient: OpenAI | null = null;

export const requireOpenAIClient = (): OpenAI => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY 未配置，请在本地 .env 中设置后重启 server。",
    );
  }

  if (!_openaiClient) {
    _openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: getOpenAITimeoutMs(),
      maxRetries: getOpenAIMaxRetries(),
    });
  }

  return _openaiClient;
};
