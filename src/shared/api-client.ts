import type { AgentAction, AgentRun, AgentRunEvent, PageContext } from "./types";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const createId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

async function* streamText(
  runId: string,
  text: string,
  channel: "thinking" | "answer" = "answer",
  messageId = createId("msg")
): AsyncGenerator<AgentRunEvent> {
  const chunks = text.match(/.{1,8}/gu) ?? [text];

  for (const chunk of chunks) {
    await delay(45);
    yield {
      type: "message_delta",
      runId,
      messageId,
      text: chunk,
      channel
    };
  }

  yield {
    type: "message_delta",
    runId,
    messageId,
    text: "",
    channel,
    done: true
  };
}

function createMockAnswer(goal: string, pageContext: PageContext) {
  const selectedText = pageContext.selectedText.trim();

  if (/翻译|translate/i.test(goal)) {
    return selectedText
      ? `模拟翻译结果：${selectedText}\n\n这里先保留原文语义并用中文表达。真实模型接入后会返回更自然的翻译、术语统一和上下文补全。`
      : "当前没有检测到选中文本，我会先使用页面摘要作为翻译对象。";
  }

  if (/解释|explain/i.test(goal)) {
    return selectedText
      ? `模拟解释：这段文本的核心是在说明“${selectedText.slice(0, 80)}”。我会拆成背景、关键概念和可能影响三个层次来解释。真实模型接入后会给出更完整的上下文说明。`
      : "当前没有检测到选中文本，我会基于页面可见内容做概要解释。";
  }

  return `我会基于当前页面上下文处理你的任务。已读取页面标题、可见文本、选区和可交互元素，并会把需要用户确认的页面动作留在聊天里等待你确认。`;
}

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
  yield* streamText(run.id, `已读取当前页面：${pageContext.title || pageContext.origin}。我正在理解你的目标并生成可确认的执行计划。`, "thinking");

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
  yield* streamText(run.id, createMockAnswer(run.goal, pageContext), "answer");

  const confirmable = steps.find((step) => step.requiresConfirmation);
  if (confirmable) {
    await delay(200);
    yield { type: "status", runId: run.id, status: "requires_confirmation" };
    yield { type: "action_request", runId: run.id, action: confirmable };
    return;
  }

  yield { type: "status", runId: run.id, status: "completed" };
}
