import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_PORT = 8787;
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const DEFAULT_OPENAI_MAX_RETRIES = 1;

export function getPort() {
  const parsed = Number(process.env.AI_AGENT_PORT ?? DEFAULT_PORT);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function getModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

export function getOpenAITimeoutMs() {
  const parsed = Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_OPENAI_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_OPENAI_TIMEOUT_MS;
}

export function getOpenAIMaxRetries() {
  const parsed = Number(process.env.OPENAI_MAX_RETRIES ?? DEFAULT_OPENAI_MAX_RETRIES);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_OPENAI_MAX_RETRIES;
}

export function getOpenAIBaseUrl() {
  return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
}

export function requireOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 未配置，请在本地 .env 中设置后重启 server。");
  }

  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: getOpenAITimeoutMs(),
    maxRetries: getOpenAIMaxRetries()
  });
}
