import type { AgentAction, AgentRun, AgentRunEvent, PageContext } from "./types";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const createId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

export async function createAgentRun(goal: string, pageContext: PageContext): Promise<AgentRun> {
  await delay(250);

  const now = new Date().toISOString();

  return {
    id: createId("run"),
    status: "created",
    goal,
    pageUrl: pageContext.url,
    pageTitle: pageContext.title,
    createdAt: now,
    updatedAt: now
  };
}

export async function* streamAgentRun(run: AgentRun, pageContext: PageContext): AsyncGenerator<AgentRunEvent> {
  yield { type: "status", runId: run.id, status: "planning" };
  await delay(500);
  yield {
    type: "message",
    runId: run.id,
    text: `已读取当前页面：${pageContext.title || pageContext.origin}`
  };

  await delay(600);

  const firstSafeElement = pageContext.interactiveElements.find(
    (element) => element.riskLevel !== "high" && !element.disabled
  );

  const steps: AgentAction[] = [
    {
      id: createId("action"),
      toolName: "read_page",
      riskLevel: "low",
      requiresConfirmation: false,
      reason: "读取页面标题、摘要和可交互元素，用于理解用户目标。"
    },
    {
      id: createId("action"),
      toolName: "summarize_selection",
      riskLevel: "low",
      requiresConfirmation: false,
      input: {
        text: pageContext.selectedText || pageContext.visibleTextSummary.slice(0, 240)
      },
      reason: pageContext.selectedText ? "优先总结用户选中的文本。" : "未检测到选区，使用页面可见摘要生成回答。"
    }
  ];

  if (firstSafeElement) {
    steps.push({
      id: createId("action"),
      toolName: "highlight_element",
      riskLevel: "low",
      requiresConfirmation: true,
      target: {
        elementId: firstSafeElement.id,
        description: firstSafeElement.label || firstSafeElement.role
      },
      reason: "高亮一个低风险页面元素，验证插件能定位并受控操作当前页面。"
    });
  }

  const blockedActions = pageContext.interactiveElements
    .filter((element) => element.riskLevel === "high")
    .slice(0, 3)
    .map<AgentAction>((element) => ({
      id: createId("blocked"),
      toolName: "click_element",
      riskLevel: "high",
      requiresConfirmation: true,
      target: {
        elementId: element.id,
        description: element.label || element.role
      },
      reason: "该元素可能触发提交、支付、登录、删除或发布等高风险动作，MVP 阶段默认阻断。"
    }));

  const plan = {
    summary: "这是本地 Mock Agent 生成的安全执行计划。真实后端接入后会沿用相同计划与动作协议。",
    steps,
    blockedActions
  };

  yield { type: "plan", runId: run.id, plan };
  await delay(300);

  const confirmable = steps.find((step) => step.requiresConfirmation);
  if (confirmable) {
    yield { type: "status", runId: run.id, status: "requires_confirmation" };
    yield { type: "action_request", runId: run.id, action: confirmable };
    return;
  }

  yield { type: "status", runId: run.id, status: "completed" };
}
