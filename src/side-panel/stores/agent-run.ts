import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createAgentRun, streamAgentRun } from "@/shared/api-client";
import type { ActionExecutionResponse } from "@/shared/extension-messages";
import type { AgentAction, AgentActionResult, AgentPlan, AgentRun, AgentRunEvent, ExtensionError, PageContext } from "@/shared/types";

type ChatRole = "user" | "assistant" | "system";
type ChatMessageKind = "text" | "thinking" | "plan" | "action_confirmation" | "result" | "error";
type ActionMessageStatus = "pending" | "executing" | "confirmed" | "rejected";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  kind: ChatMessageKind;
  content: string;
  createdAt: string;
  streaming?: boolean;
  plan?: AgentPlan;
  action?: AgentAction;
  actionStatus?: ActionMessageStatus;
  result?: AgentActionResult;
}

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const createMessageId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useAgentRunStore = defineStore("agent-run", () => {
  const run = ref<AgentRun | null>(null);
  const plan = ref<AgentPlan | null>(null);
  const events = ref<AgentRunEvent[]>([]);
  const pendingAction = ref<AgentAction | null>(null);
  const results = ref<AgentActionResult[]>([]);
  const messages = ref<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      kind: "text",
      content: "你好，我可以读取当前网页、解释选中文本，并在需要操作页面时先把动作发到这里让你确认。",
      createdAt: new Date().toISOString()
    }
  ]);
  const loading = ref(false);
  const error = ref<ExtensionError | null>(null);

  const hasRun = computed(() => Boolean(run.value));
  const canSend = computed(() => !loading.value && !pendingAction.value);
  const statusLabel = computed(() => run.value?.status ?? "idle");

  function reset() {
    run.value = null;
    plan.value = null;
    events.value = [];
    pendingAction.value = null;
    results.value = [];
    messages.value = [];
    error.value = null;
    loading.value = false;
  }

  function pushMessage(message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string }) {
    const chatMessage: ChatMessage = {
      ...message,
      id: message.id ?? createMessageId(message.kind),
      createdAt: new Date().toISOString()
    };

    messages.value.push(chatMessage);
    return chatMessage;
  }

  function appendTextDelta(messageId: string, text: string, done = false, kind: ChatMessageKind = "thinking") {
    let message = messages.value.find((item) => item.id === messageId);

    if (!message) {
      message = pushMessage({
        id: messageId,
        role: "assistant",
        kind,
        content: "",
        streaming: true
      });
    }

    message.content += text;
    message.streaming = !done;
  }

  async function streamLocalAssistantText(text: string) {
    const messageId = createMessageId("local_stream");
    const chunks = text.match(/.{1,8}/gu) ?? [text];

    for (const chunk of chunks) {
      appendTextDelta(messageId, chunk, false, "text");
      await delay(35);
    }

    appendTextDelta(messageId, "", true, "text");
  }

  function formatPlan(planValue: AgentPlan) {
    const steps = planValue.steps.map((step, index) => `${index + 1}. ${step.toolName}：${step.reason}`).join("\n");
    const blocked = planValue.blockedActions.length
      ? `\n\n已阻断的高风险动作：\n${planValue.blockedActions
          .map((action) => `- ${action.target?.description ?? action.toolName}：${action.reason}`)
          .join("\n")}`
      : "";

    return `${planValue.summary}\n\n计划：\n${steps}${blocked}`;
  }

  function updateActionMessage(actionId: string, status: ActionMessageStatus, content?: string) {
    const message = messages.value.find((item) => item.action?.id === actionId);

    if (!message) {
      return;
    }

    message.actionStatus = status;
    if (content) {
      message.content = content;
    }
  }

  async function applyEvent(event: AgentRunEvent) {
    events.value.push(event);

    if (event.type === "status" && run.value) {
      run.value.status = event.status;
      run.value.updatedAt = new Date().toISOString();
    }

    if (event.type === "message") {
      pushMessage({
        role: "assistant",
        kind: "text",
        content: event.text
      });
    }

    if (event.type === "message_delta") {
      appendTextDelta(event.messageId, event.text, event.done, event.channel === "answer" ? "text" : "thinking");
    }

    if (event.type === "plan") {
      plan.value = event.plan;
      if (run.value) {
        run.value.plan = event.plan;
      }
      pushMessage({
        role: "assistant",
        kind: "plan",
        content: formatPlan(event.plan),
        plan: event.plan
      });
    }

    if (event.type === "action_request") {
      pushMessage({
        id: `action_${event.action.id}`,
        role: "assistant",
        kind: "action_confirmation",
        content: event.action.reason,
        action: event.action,
        actionStatus: event.action.requiresConfirmation ? "pending" : "executing"
      });

      if (event.action.requiresConfirmation) {
        pendingAction.value = event.action;
      } else {
        await executeAction(event.action, {
          completionText: "动作已自动完成。我会继续把执行结果保留在当前对话里。"
        });
      }
    }

    if (event.type === "action_result") {
      results.value.push(event.result);
      pushMessage({
        role: "assistant",
        kind: "result",
        content: `${event.result.status}：${event.result.message}`,
        result: event.result
      });
    }

    if (event.type === "error") {
      error.value = event.error;
      pushMessage({
        role: "assistant",
        kind: "error",
        content: event.error.message
      });
    }
  }

  async function start(goal: string, pageContext: PageContext) {
    if (loading.value || pendingAction.value) {
      return;
    }

    loading.value = true;
    error.value = null;
    plan.value = null;
    pendingAction.value = null;
    results.value = [];
    events.value = [];
    pushMessage({
      role: "user",
      kind: "text",
      content: goal
    });

    try {
      run.value = await createAgentRun(goal, pageContext);

      for await (const event of streamAgentRun(run.value, pageContext)) {
        await applyEvent(event);
      }
    } catch (caught) {
      error.value = {
        code: "UNKNOWN_ERROR",
        message: caught instanceof Error ? caught.message : "Agent 运行失败。",
        retryable: true
      };
      pushMessage({
        role: "assistant",
        kind: "error",
        content: error.value.message
      });
    } finally {
      loading.value = false;
    }
  }

  async function executeAction(action: AgentAction, options?: { completionText?: string }) {
    if (!run.value) {
      return;
    }

    loading.value = true;
    updateActionMessage(action.id, "executing");
    applyEvent({ type: "status", runId: run.value.id, status: "running" });

    try {
      const response = (await chrome.runtime.sendMessage({
        type: "agent_action:execute",
        payload: {
          runId: run.value.id,
          action
        }
      })) as ActionExecutionResponse;

      const result: AgentActionResult = response.ok
        ? response.data
        : {
            actionId: action.id,
            status: "failed",
            message: response.error.message,
            error: response.error
          };

      if (pendingAction.value?.id === action.id) {
        pendingAction.value = null;
      }
      updateActionMessage(action.id, result.status === "succeeded" ? "confirmed" : "rejected");
      applyEvent({ type: "action_result", runId: run.value.id, result });
      applyEvent({
        type: "status",
        runId: run.value.id,
        status: result.status === "succeeded" ? "completed" : "failed"
      });
      await streamLocalAssistantText(
        result.status === "succeeded"
          ? options?.completionText ?? "动作已完成。我会继续把执行结果保留在当前对话里。"
          : "动作没有成功执行，原因已经显示在上方。"
      );
    } finally {
      loading.value = false;
    }
  }

  async function executePendingAction() {
    if (!pendingAction.value) {
      return;
    }

    await executeAction(pendingAction.value);
  }

  function rejectPendingAction() {
    if (!pendingAction.value || !run.value) {
      return;
    }

    const action = pendingAction.value;
    const result: AgentActionResult = {
      actionId: action.id,
      status: "skipped",
      message: "用户跳过了该动作。"
    };

    updateActionMessage(action.id, "rejected");
    pendingAction.value = null;
    applyEvent({ type: "action_result", runId: run.value.id, result });
    applyEvent({ type: "status", runId: run.value.id, status: "completed" });
    void streamLocalAssistantText("已跳过该动作。我不会修改当前网页。");
  }

  return {
    run,
    plan,
    events,
    pendingAction,
    results,
    messages,
    loading,
    error,
    hasRun,
    canSend,
    statusLabel,
    start,
    executePendingAction,
    rejectPendingAction,
    reset
  };
});
