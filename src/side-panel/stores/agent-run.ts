import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createAgentRun, stopAgentRun, streamAgentRun } from "@/shared/api-client";
import type { ActionExecutionResponse } from "@/shared/extension-messages";
import type { AgentAction, AgentActionResult, AgentPlan, AgentRun, AgentRunEvent, ExtensionError, PageContext } from "@/shared/types";
import {
  appendTextDelta,
  applyAgentRunEvent,
  createMessageId,
  createWelcomeMessage,
  finishStreamingMessages,
  pushMessage,
  updateActionMessage,
  type AgentRunMessageState
} from "./agent-run-messages";

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export const useAgentRunStore = defineStore("agent-run", () => {
  const run = ref<AgentRun | null>(null);
  const plan = ref<AgentPlan | null>(null);
  const events = ref<AgentRunEvent[]>([]);
  const pendingAction = ref<AgentAction | null>(null);
  const results = ref<AgentActionResult[]>([]);
  const messages = ref([createWelcomeMessage()]);
  const loading = ref(false);
  const stopping = ref(false);
  const stopRequested = ref(false);
  const silentStopRequested = ref(false);
  const activeAbortController = ref<AbortController | null>(null);
  const error = ref<ExtensionError | null>(null);

  const hasRun = computed(() => Boolean(run.value));
  const canSend = computed(() => !loading.value && !pendingAction.value);
  const canStop = computed(() => Boolean(activeAbortController.value) && loading.value);
  const statusLabel = computed(() => run.value?.status ?? "idle");

  function getMessageState(): AgentRunMessageState {
    return {
      run: run.value,
      plan: plan.value,
      events: events.value,
      pendingAction: pendingAction.value,
      results: results.value,
      messages: messages.value
    };
  }

  function commitMessageState(state: AgentRunMessageState) {
    run.value = state.run;
    plan.value = state.plan;
    pendingAction.value = state.pendingAction;
  }

  function reset() {
    run.value = null;
    plan.value = null;
    events.value = [];
    pendingAction.value = null;
    results.value = [];
    messages.value = [];
    error.value = null;
    stopping.value = false;
    stopRequested.value = false;
    silentStopRequested.value = true;
    activeAbortController.value?.abort();
    activeAbortController.value = null;
    loading.value = false;
  }

  async function streamLocalAssistantText(text: string) {
    const messageId = createMessageId("local_stream");
    const chunks = text.match(/.{1,8}/gu) ?? [text];

    for (const chunk of chunks) {
      appendTextDelta({ messages: messages.value }, messageId, chunk, false, "text");
      await delay(35);
    }

    appendTextDelta({ messages: messages.value }, messageId, "", true, "text");
  }

  function isAbortError(caught: unknown) {
    return caught instanceof Error && (caught.name === "AbortError" || /aborted|abort/i.test(caught.message));
  }

  function markStopped() {
    finishStreamingMessages({ messages: messages.value });
    if (run.value) {
      run.value.status = "stopped";
      run.value.updatedAt = new Date().toISOString();
      events.value.push({ type: "status", runId: run.value.id, status: "stopped" });
    }
  }

  async function applyEvent(event: AgentRunEvent) {
    const state = getMessageState();
    const result = applyAgentRunEvent(state, event);
    commitMessageState(state);

    if (result.error) {
      error.value = result.error.error;
    }

    if (result.autoAction) {
      await executeAction(result.autoAction, {
        completionText: "动作已自动完成。我会继续把执行结果保留在当前对话里。"
      });
    }
  }

  async function start(goal: string, pageContext: PageContext) {
    if (loading.value || pendingAction.value) {
      return;
    }

    const abortController = new AbortController();
    loading.value = true;
    stopping.value = false;
    stopRequested.value = false;
    silentStopRequested.value = false;
    activeAbortController.value = abortController;
    error.value = null;
    plan.value = null;
    pendingAction.value = null;
    results.value = [];
    events.value = [];
    pushMessage({ messages: messages.value }, {
      role: "user",
      kind: "text",
      content: goal
    });

    try {
      run.value = await createAgentRun(goal, pageContext, {
        signal: abortController.signal
      });

      for await (const event of streamAgentRun(run.value, pageContext, {
        signal: abortController.signal
      })) {
        await applyEvent(event);
      }
    } catch (caught) {
      if (stopRequested.value || isAbortError(caught)) {
        if (!silentStopRequested.value) {
          markStopped();
          pushMessage({ messages: messages.value }, {
            role: "assistant",
            kind: "text",
            content: "已终止当前回答。"
          });
        }
        return;
      }

      error.value = {
        code: "UNKNOWN_ERROR",
        message: caught instanceof Error ? caught.message : "Agent 运行失败。",
        retryable: true
      };
      pushMessage({ messages: messages.value }, {
        role: "assistant",
        kind: "error",
        content: error.value.message
      });
    } finally {
      if (activeAbortController.value === abortController) {
        activeAbortController.value = null;
      }
      stopping.value = false;
      silentStopRequested.value = false;
      loading.value = false;
    }
  }

  async function stop() {
    if (!canStop.value) {
      return;
    }

    stopRequested.value = true;
    stopping.value = true;
    const runId = run.value?.id;
    activeAbortController.value?.abort();

    if (!runId) {
      markStopped();
      return;
    }

    try {
      await stopAgentRun(runId);
    } catch {
      // The local abort above already stops the visible stream; the backend may have closed first.
    }
  }

  async function executeAction(action: AgentAction, options?: { completionText?: string }) {
    if (!run.value) {
      return;
    }

    loading.value = true;
    updateActionMessage({ messages: messages.value }, action.id, "executing");
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
      updateActionMessage({ messages: messages.value }, action.id, result.status === "succeeded" ? "confirmed" : "rejected");
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

    updateActionMessage({ messages: messages.value }, action.id, "rejected");
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
    stopping,
    error,
    hasRun,
    canSend,
    canStop,
    statusLabel,
    start,
    stop,
    executePendingAction,
    rejectPendingAction,
    reset
  };
});
