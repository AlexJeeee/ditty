import { MODEL_TOOL_PLAN_STEPS } from "./model-tools";

/**
 * System prompt for the AI agent. Instructs the model to respond in Chinese,
 * use available tools only when necessary, and never claim actions have been
 * executed (tool calls only create pending confirmations).
 */
export const SYSTEM_PROMPT =
  "你是一个运行在 Chrome 侧边栏里的网页 AI 助手。请用中文回答，优先结合用户任务和网页上下文。你可以在用户明确要求或任务确实需要时调用可用工具。工具调用会根据情况生成待确认动作，或者立即执行；点击页面元素或填写表单时，只能使用当前网页上下文中可交互元素摘要明确给出的 id；操作标签页或标签页分组时，必须先通过工具结果获得明确的 tab_id 或 group_id。如果工具参数不确定，请不要猜测，改为向用户说明缺口。";
import { createScopedId } from "../src/shared/id";
import type { AgentAction, AgentPlan, PageContext } from "../src/shared/types";

export const createPlan = (pageContext: PageContext): AgentPlan => {
  const steps: AgentAction[] = [
    {
      id: createScopedId("action"),
      toolName: "read_page",
      riskLevel: "low",
      requiresConfirmation: false,
      reason: `读取当前页面标题、URL、选区和可见文本摘要：${pageContext.title || pageContext.origin || "当前页面"}。`,
    },
    {
      id: createScopedId("action"),
      toolName: "summarize_selection",
      riskLevel: "low",
      requiresConfirmation: false,
      input: {
        text:
          pageContext.selectedText ||
          pageContext.visibleTextSummary.slice(0, 240),
      },
      reason: pageContext.selectedText
        ? "优先结合用户选中的网页文本回答。"
        : "未检测到选区，结合页面可见内容摘要回答。",
    },
    ...MODEL_TOOL_PLAN_STEPS.map((step) => ({
      ...step,
      id: createScopedId("action"),
    })),
  ];

  return {
    summary:
      "模型可以请求打开网页、填写输入框、点击当前页元素，或管理浏览器标签页/分组；会改变浏览器状态的动作需等待你确认。",
    steps,
    blockedActions: [],
  };
};

export const buildPrompt = (goal: string, pageContext: PageContext) => {
  const elements = pageContext.interactiveElements
    .map((element, index) => {
      const label =
        element.label ||
        element.placeholder ||
        element.valuePreview ||
        element.role;
      const details = [
        `risk=${element.riskLevel}`,
        `disabled=${element.disabled ? "true" : "false"}`,
        element.inputType ? `inputType=${element.inputType}` : "",
        element.placeholder ? `placeholder=${element.placeholder}` : "",
      ].filter(Boolean);
      return `${index + 1}. id=${element.id} ${element.role} ${label ? `- ${label}` : ""} [${details.join(", ")}]`;
    })
    .join("\n");

  return [
    `用户任务：${goal}`,
    "",
    "当前网页上下文：",
    `标题：${pageContext.title || "(无标题)"}`,
    `URL：${pageContext.url}`,
    `来源：${pageContext.origin || "(未知)"}`,
    `采集时间：${pageContext.collectedAt || "(未知)"}`,
    "",
    "选中文本：",
    pageContext.selectedText || "(无)",
    "",
    "页面可见文本摘要：",
    pageContext.visibleTextSummary || "(无)",
    "",
    "页面标题结构：",
    pageContext.headings
      .map((heading) => `${"#".repeat(heading.level)} ${heading.text}`)
      .join("\n") || "(无)",
    "",
    "可交互元素摘要：",
    elements || "(无)",
  ].join("\n");
};
