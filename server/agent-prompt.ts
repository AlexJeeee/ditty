import { MODEL_TOOL_PLAN_STEPS } from "./model-tools";
import { createScopedId } from "../src/shared/id";
import type { AgentAction, AgentPlan, PageContext } from "../src/shared/types";

export function createPlan(pageContext: PageContext): AgentPlan {
  const steps: AgentAction[] = [
    {
      id: createScopedId("action"),
      toolName: "read_page",
      riskLevel: "low",
      requiresConfirmation: false,
      reason: `读取当前页面标题、URL、选区和可见文本摘要：${pageContext.title || pageContext.origin || "当前页面"}。`
    },
    {
      id: createScopedId("action"),
      toolName: "summarize_selection",
      riskLevel: "low",
      requiresConfirmation: false,
      input: {
        text: pageContext.selectedText || pageContext.visibleTextSummary.slice(0, 240)
      },
      reason: pageContext.selectedText ? "优先结合用户选中的网页文本回答。" : "未检测到选区，结合页面可见内容摘要回答。"
    },
    ...MODEL_TOOL_PLAN_STEPS.map((step) => ({
      ...step,
      id: createScopedId("action")
    }))
  ];

  return {
    summary: "已接入 OpenAI 真实模型。模型可以请求打开网页，但必须先生成白名单工具动作并等待你确认。",
    steps,
    blockedActions: []
  };
}

export function buildPrompt(goal: string, pageContext: PageContext) {
  const elements = pageContext.interactiveElements
    .map((element, index) => {
      const label = element.label || element.placeholder || element.valuePreview || element.role;
      return `${index + 1}. ${element.role} ${label ? `- ${label}` : ""} [risk=${element.riskLevel}]`;
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
    pageContext.headings.map((heading) => `${"#".repeat(heading.level)} ${heading.text}`).join("\n") || "(无)",
    "",
    "可交互元素摘要：",
    elements || "(无)"
  ].join("\n");
}
