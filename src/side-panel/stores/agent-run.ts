import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createAgentRun, streamAgentRun } from "@/shared/api-client";
import type { ActionExecutionResponse } from "@/shared/extension-messages";
import type { AgentAction, AgentActionResult, AgentPlan, AgentRun, AgentRunEvent, ExtensionError, PageContext } from "@/shared/types";

export const useAgentRunStore = defineStore("agent-run", () => {
  const run = ref<AgentRun | null>(null);
  const plan = ref<AgentPlan | null>(null);
  const events = ref<AgentRunEvent[]>([]);
  const pendingAction = ref<AgentAction | null>(null);
  const results = ref<AgentActionResult[]>([]);
  const loading = ref(false);
  const error = ref<ExtensionError | null>(null);

  const hasRun = computed(() => Boolean(run.value));

  function reset() {
    run.value = null;
    plan.value = null;
    events.value = [];
    pendingAction.value = null;
    results.value = [];
    error.value = null;
    loading.value = false;
  }

  function applyEvent(event: AgentRunEvent) {
    events.value.push(event);

    if (event.type === "status" && run.value) {
      run.value.status = event.status;
      run.value.updatedAt = new Date().toISOString();
    }

    if (event.type === "plan") {
      plan.value = event.plan;
      if (run.value) {
        run.value.plan = event.plan;
      }
    }

    if (event.type === "action_request") {
      pendingAction.value = event.action;
    }

    if (event.type === "action_result") {
      results.value.push(event.result);
    }

    if (event.type === "error") {
      error.value = event.error;
    }
  }

  async function start(goal: string, pageContext: PageContext) {
    reset();
    loading.value = true;

    try {
      run.value = await createAgentRun(goal, pageContext);

      for await (const event of streamAgentRun(run.value, pageContext)) {
        applyEvent(event);
      }
    } catch (caught) {
      error.value = {
        code: "UNKNOWN_ERROR",
        message: caught instanceof Error ? caught.message : "Agent 运行失败。",
        retryable: true
      };
    } finally {
      loading.value = false;
    }
  }

  async function executePendingAction() {
    if (!run.value || !pendingAction.value) {
      return;
    }

    const action = pendingAction.value;
    applyEvent({ type: "status", runId: run.value.id, status: "running" });

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

    results.value.push(result);
    pendingAction.value = null;

    applyEvent({
      type: "status",
      runId: run.value.id,
      status: result.status === "succeeded" ? "completed" : "failed"
    });
  }

  function rejectPendingAction() {
    if (!pendingAction.value || !run.value) {
      return;
    }

    results.value.push({
      actionId: pendingAction.value.id,
      status: "skipped",
      message: "用户跳过了该动作。"
    });
    pendingAction.value = null;
    applyEvent({ type: "status", runId: run.value.id, status: "completed" });
  }

  return {
    run,
    plan,
    events,
    pendingAction,
    results,
    loading,
    error,
    hasRun,
    start,
    executePendingAction,
    rejectPendingAction,
    reset
  };
});
