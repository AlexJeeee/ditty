import type { AgentToolName } from "./types";

export const MOCK_USER_EMAIL = "demo@chrome-ai-agent.local";

export const SAFE_TOOLS: AgentToolName[] = [
  "read_page",
  "summarize_selection",
  "extract_table",
  "highlight_element",
  "click_element",
  "fill_input",
  "scroll_page",
  "open_url",
  "copy_result"
];

export const SENSITIVE_FIELD_PATTERN =
  /(password|passwd|pwd|token|secret|card|credit|cvv|cvc|otp|code|captcha|idcard|identity|ssn)/i;

export const HIGH_RISK_LABEL_PATTERN =
  /(pay|付款|支付|购买|buy|purchase|delete|remove|删除|submit|提交|login|登录|register|注册|send|发送|post|发布|upload|上传|withdraw|提现|transfer|转账)/i;
