import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  createAgentRun,
  deleteChatSession,
  getChatSession,
  listModels,
  listChatSessions,
  saveChatSession,
  stopAgentRun,
  streamAgentRun,
} from "@/shared/api-client";
import { createScopedId } from "@/shared/id";
import type {
  ActionExecutionResponse,
  PageContextResponse,
} from "@/shared/extension-messages";
import type {
  AgentAction,
  AgentActionResult,
  AgentPlan,
  AgentRun,
  AgentRunEvent,
  ChatSessionSnapshot,
  ChatSessionSummary,
  ExtensionError,
  ModelProvider,
  ModelRoute,
  ModelConversationMessage,
  PageContext,
} from "@/shared/types";
import { useAuthStore } from "./auth";
import {
  appendTextDelta,
  applyAgentRunEvent,
  createMessageId,
  createWelcomeMessage,
  finishStreamingMessages,
  pushMessage,
  updateActionMessage,
  type AgentRunMessageState,
} from "./agent-run-messages";
import {
  createChatSessionTitle,
  createLastMessagePreview,
  sanitizeMessagesForHydration,
  sanitizeMessagesForPersistence,
  sanitizeSnapshotForHydration,
} from "./chat-session-snapshot";

const delay = (ms: number) =>
  new Promise((resolve) => window.setTimeout(resolve, ms));
const CONTINUATION_CONTEXT_RETRY_DELAYS = [300, 1000, 1800];
const CHAT_SAVE_DEBOUNCE_MS = 500;
const MODEL_ROUTE_STORAGE_KEY = "ditty:selectedModelRoute";

export const useAgentRunStore = defineStore("agent-run", () => {
  let persistTimer: number | null = null;
  const run = ref<AgentRun | null>(null);
  const plan = ref<AgentPlan | null>(null);
  const events = ref<AgentRunEvent[]>([]);
  const pendingAction = ref<AgentAction | null>(null);
  const results = ref<AgentActionResult[]>([]);
  const messages = ref([createWelcomeMessage()]);
  const modelConversation = ref<ModelConversationMessage[]>([]);
  const currentPageContext = ref<PageContext | null>(null);
  const activeSessionId = ref<string | null>(null);
  const chatSessions = ref<ChatSessionSummary[]>([]);
  const modelProviders = ref<ModelProvider[]>([]);
  const selectedModelRoute = ref<ModelRoute | null>(null);
  const modelLoading = ref(false);
  const modelError = ref<string | null>(null);
  const historyLoading = ref(false);
  const historySaving = ref(false);
  const historyError = ref<string | null>(null);
  const loading = ref(false);
  const stopping = ref(false);
  const stopRequested = ref(false);
  const silentStopRequested = ref(false);
  const activeAbortController = ref<AbortController | null>(null);
  const error = ref<ExtensionError | null>(null);

  const hasRun = computed(() => Boolean(run.value));
  const canSend = computed(() => !loading.value && !pendingAction.value);
  const canStop = computed(
    () => Boolean(activeAbortController.value) && loading.value,
  );
  const statusLabel = computed(() => run.value?.status ?? "idle");

  const normalizeModelRoute = (
    route: ModelRoute | null | undefined,
    providers = modelProviders.value,
  ): ModelRoute | null => {
    if (!providers.length) {
      return null;
    }

    const provider =
      providers.find((item) => item.id === route?.providerId) ?? providers[0];
    const model =
      provider.models.find((item) => item.id === route?.modelId) ??
      provider.models[0];

    if (!model) {
      return null;
    }

    return {
      providerId: provider.id,
      modelId: model.id,
    };
  };

  const readStoredModelRoute = async () => {
    try {
      const stored = await chrome.storage.local.get(MODEL_ROUTE_STORAGE_KEY);
      const route = stored[MODEL_ROUTE_STORAGE_KEY] as ModelRoute | undefined;

      return route ?? null;
    } catch {
      return null;
    }
  };

  const persistSelectedModelRoute = async (route: ModelRoute) => {
    try {
      await chrome.storage.local.set({
        [MODEL_ROUTE_STORAGE_KEY]: route,
      });
    } catch {
      // The selected route still applies for this runtime session.
    }
  };

  const setSelectedModelRoute = (route: ModelRoute) => {
    const normalized = normalizeModelRoute(route);

    if (!normalized) {
      return;
    }

    selectedModelRoute.value = normalized;
    void persistSelectedModelRoute(normalized);
  };

  const loadModels = async () => {
    modelLoading.value = true;
    modelError.value = null;

    try {
      const [response, storedRoute] = await Promise.all([
        listModels(),
        readStoredModelRoute(),
      ]);
      modelProviders.value = response.providers;
      selectedModelRoute.value = normalizeModelRoute(
        storedRoute ?? response.defaultRoute,
        response.providers,
      );

      if (selectedModelRoute.value) {
        void persistSelectedModelRoute(selectedModelRoute.value);
      }
    } catch (caught) {
      modelError.value =
        caught instanceof Error ? caught.message : "模型列表读取失败。";
    } finally {
      modelLoading.value = false;
    }
  };

  const clearPersistTimer = () => {
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer);
      persistTimer = null;
    }
  };

  const createSessionSummary = (
    snapshot: ChatSessionSnapshot,
  ): ChatSessionSummary => ({
    id: snapshot.id,
    title: snapshot.title,
    pageUrl: snapshot.pageUrl,
    pageTitle: snapshot.pageTitle,
    lastMessagePreview: snapshot.lastMessagePreview,
    messageCount: snapshot.messages.length,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  });

  const upsertSessionSummary = (snapshot: ChatSessionSnapshot) => {
    const summary = createSessionSummary(snapshot);
    chatSessions.value = [
      summary,
      ...chatSessions.value.filter((session) => session.id !== summary.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  };

  const ensureActiveSession = () => {
    activeSessionId.value ??= createScopedId("chat", 6);
    return activeSessionId.value;
  };

  const buildSnapshot = (): ChatSessionSnapshot | null => {
    const persistedMessages = sanitizeMessagesForPersistence(messages.value);

    if (!persistedMessages.length) {
      return null;
    }

    const sessionId = ensureActiveSession();
    const existingSession = chatSessions.value.find(
      (session) => session.id === sessionId,
    );
    const now = new Date().toISOString();
    const pageUrl = run.value?.pageUrl ?? currentPageContext.value?.url ?? "";
    const pageTitle =
      run.value?.pageTitle ?? currentPageContext.value?.title ?? "";

    return {
      id: sessionId,
      title: createChatSessionTitle(
        persistedMessages,
        run.value?.goal || pageTitle || "新对话",
      ),
      pageUrl,
      pageTitle,
      lastMessagePreview: createLastMessagePreview(persistedMessages),
      createdAt:
        existingSession?.createdAt ??
        run.value?.createdAt ??
        messages.value[0]?.createdAt ??
        now,
      updatedAt: now,
      run: run.value,
      plan: plan.value,
      events: events.value,
      pendingAction: pendingAction.value,
      results: results.value,
      messages: persistedMessages,
      modelConversation: modelConversation.value,
    };
  };

  const persistActiveSession = async () => {
    const snapshot = buildSnapshot();

    if (!snapshot) {
      return;
    }

    historySaving.value = true;
    historyError.value = null;

    try {
      const savedSnapshot = await saveChatSession(snapshot);
      upsertSessionSummary(savedSnapshot);
    } catch (caught) {
      historyError.value =
        caught instanceof Error ? caught.message : "历史聊天保存失败。";
    } finally {
      historySaving.value = false;
    }
  };

  const schedulePersist = () => {
    if (!sanitizeMessagesForPersistence(messages.value).length) {
      return;
    }

    clearPersistTimer();
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      void persistActiveSession();
    }, CHAT_SAVE_DEBOUNCE_MS);
  };

  const resetRuntimeState = () => {
    run.value = null;
    plan.value = null;
    events.value = [];
    pendingAction.value = null;
    results.value = [];
    messages.value = [createWelcomeMessage()];
    modelConversation.value = [];
    currentPageContext.value = null;
    error.value = null;
    stopping.value = false;
    stopRequested.value = false;
    silentStopRequested.value = true;
    activeAbortController.value?.abort();
    activeAbortController.value = null;
    loading.value = false;
  };

  const startNewChat = async () => {
    clearPersistTimer();
    await persistActiveSession();
    activeSessionId.value = null;
    resetRuntimeState();
  };

  const reset = () => {
    void startNewChat();
  };

  const clearForSignedOut = () => {
    clearPersistTimer();
    resetRuntimeState();
    activeSessionId.value = null;
    chatSessions.value = [];
    historyLoading.value = false;
    historySaving.value = false;
    historyError.value = null;
  };

  const loadChatSessions = async () => {
    historyLoading.value = true;
    historyError.value = null;

    try {
      chatSessions.value = await listChatSessions();
    } catch (caught) {
      historyError.value =
        caught instanceof Error ? caught.message : "历史聊天读取失败。";
    } finally {
      historyLoading.value = false;
    }
  };

  const hydrateFromSnapshot = (snapshotValue: ChatSessionSnapshot) => {
    const snapshot = sanitizeSnapshotForHydration(snapshotValue);

    clearPersistTimer();
    activeAbortController.value?.abort();
    activeAbortController.value = null;
    loading.value = false;
    stopping.value = false;
    stopRequested.value = false;
    silentStopRequested.value = true;
    activeSessionId.value = snapshot.id;
    run.value = snapshot.run;
    plan.value = snapshot.plan;
    events.value = snapshot.events;
    pendingAction.value = snapshot.pendingAction;
    results.value = snapshot.results;
    messages.value = snapshot.messages.length
      ? sanitizeMessagesForHydration(snapshot.messages)
      : [createWelcomeMessage()];
    modelConversation.value = snapshot.modelConversation;
    currentPageContext.value = null;
    error.value = null;
    upsertSessionSummary(snapshot);
  };

  const selectChatSession = async (sessionId: string) => {
    if (sessionId === activeSessionId.value) {
      return;
    }

    clearPersistTimer();
    await persistActiveSession();
    historyLoading.value = true;
    historyError.value = null;

    try {
      hydrateFromSnapshot(await getChatSession(sessionId));
    } catch (caught) {
      historyError.value =
        caught instanceof Error ? caught.message : "历史聊天读取失败。";
    } finally {
      historyLoading.value = false;
    }
  };

  const removeChatSession = async (sessionId: string) => {
    if (activeSessionId.value === sessionId) {
      clearPersistTimer();
    }

    historyError.value = null;

    try {
      await deleteChatSession(sessionId);
      chatSessions.value = chatSessions.value.filter(
        (session) => session.id !== sessionId,
      );

      if (activeSessionId.value === sessionId) {
        activeSessionId.value = null;
        resetRuntimeState();
      }
    } catch (caught) {
      historyError.value =
        caught instanceof Error ? caught.message : "历史聊天删除失败。";
    }
  };

  const streamLocalAssistantText = async (text: string) => {
    const messageId = createMessageId("local_stream");
    const chunks = text.match(/.{1,8}/gu) ?? [text];

    for (const chunk of chunks) {
      appendTextDelta(
        { messages: messages.value },
        messageId,
        chunk,
        false,
        "text",
      );
      await delay(35);
    }

    appendTextDelta({ messages: messages.value }, messageId, "", true, "text");
    schedulePersist();
  };

  const isAbortError = (caught: unknown) => {
    return (
      caught instanceof Error &&
      (caught.name === "AbortError" || /aborted|abort/i.test(caught.message))
    );
  };

  const markStopped = () => {
    finishStreamingMessages({ messages: messages.value });
    if (run.value) {
      run.value.status = "stopped";
      run.value.updatedAt = new Date().toISOString();
      events.value.push({
        type: "status",
        runId: run.value.id,
        status: "stopped",
      });
    }
    schedulePersist();
  };

  const applyEvent = async (event: AgentRunEvent) => {
    if (event.type === "conversation_message") {
      modelConversation.value.push(event.message);
    }

    // Build a plain state snapshot for the pure helper, then write back the
    // fields it may have reassigned (run, plan, pendingAction).
    const state: AgentRunMessageState = {
      run: run.value,
      plan: plan.value,
      events: events.value,
      pendingAction: pendingAction.value,
      results: results.value,
      messages: messages.value,
    };
    const result = applyAgentRunEvent(state, event);
    run.value = state.run;
    plan.value = state.plan;
    pendingAction.value = state.pendingAction;

    if (result.error) {
      error.value = result.error.error;
    }

    if (result.autoAction) {
      await executeAction(result.autoAction);
    }

    schedulePersist();
  };

  const consumeRunStream = async (
    pageContext: PageContext,
    abortController: AbortController,
    options?: { conversation?: ModelConversationMessage[] },
  ) => {
    currentPageContext.value = pageContext;

    for await (const event of streamAgentRun(run.value!, pageContext, {
      signal: abortController.signal,
      conversation: options?.conversation,
    })) {
      await applyEvent(event);
    }
  };

  const getContinuationTabId = (result: AgentActionResult) => {
    const output = result.output;

    if (!output || typeof output !== "object" || Array.isArray(output)) {
      return undefined;
    }

    const outputRecord = output as Record<string, unknown>;
    if (typeof outputRecord.tabId === "number") {
      return outputRecord.tabId;
    }

    const pageAction = outputRecord.pageAction;
    if (
      !pageAction ||
      typeof pageAction !== "object" ||
      Array.isArray(pageAction)
    ) {
      return undefined;
    }

    const targetTab = (pageAction as Record<string, unknown>).targetTab;
    if (
      !targetTab ||
      typeof targetTab !== "object" ||
      Array.isArray(targetTab)
    ) {
      return undefined;
    }

    const id = (targetTab as Record<string, unknown>).id;
    return typeof id === "number" ? id : undefined;
  };

  const refreshPageContextForContinuation = async (tabId?: number) => {
    for (const retryDelay of CONTINUATION_CONTEXT_RETRY_DELAYS) {
      await delay(retryDelay);

      try {
        const response = (await chrome.runtime.sendMessage({
          type: "page_context:get",
          payload: {
            includeSelection: true,
            includeInteractiveElements: true,
            tabId,
          },
        })) as PageContextResponse;

        if (response?.ok) {
          currentPageContext.value = response.data;
          return response.data;
        }
      } catch {
        // The target tab may still be navigating; retry before falling back.
      }
    }

    return tabId ? null : currentPageContext.value;
  };

  const continueAfterToolResult = async (result: AgentActionResult) => {
    if (!run.value) {
      return;
    }

    const nextPageContext = await refreshPageContextForContinuation(
      getContinuationTabId(result),
    );

    if (!nextPageContext) {
      applyEvent({ type: "status", runId: run.value.id, status: "completed" });
      await streamLocalAssistantText(
        "动作结果已记录，但新页面上下文暂时不可读。请等页面加载完成后刷新上下文继续。",
      );
      return;
    }

    const abortController = new AbortController();
    activeAbortController.value = abortController;

    try {
      await consumeRunStream(nextPageContext, abortController, {
        conversation: modelConversation.value,
      });
    } catch (caught) {
      if (stopRequested.value || isAbortError(caught)) {
        if (!silentStopRequested.value) {
          markStopped();
          pushMessage(
            { messages: messages.value },
            {
              role: "assistant",
              kind: "text",
              content: "已终止当前回答。",
            },
          );
          schedulePersist();
        }
        return;
      }

      error.value = {
        code: "UNKNOWN_ERROR",
        message:
          caught instanceof Error ? caught.message : "Agent 继续运行失败。",
        retryable: true,
      };
      pushMessage(
        { messages: messages.value },
        {
          role: "assistant",
          kind: "error",
          content: error.value.message,
        },
      );
      schedulePersist();
    } finally {
      if (activeAbortController.value === abortController) {
        activeAbortController.value = null;
      }
    }
  };

  const start = async (goal: string, pageContext: PageContext) => {
    if (loading.value || pendingAction.value) {
      return;
    }

    const abortController = new AbortController();
    loading.value = true;
    stopping.value = false;
    stopRequested.value = false;
    silentStopRequested.value = false;
    activeAbortController.value = abortController;
    currentPageContext.value = pageContext;
    error.value = null;
    plan.value = null;
    pendingAction.value = null;
    results.value = [];
    events.value = [];
    pushMessage(
      { messages: messages.value },
      {
        role: "user",
        kind: "text",
        content: goal,
      },
    );
    ensureActiveSession();
    schedulePersist();

    try {
      run.value = await createAgentRun(
        goal,
        pageContext,
        modelConversation.value,
        selectedModelRoute.value ?? undefined,
        {
          signal: abortController.signal,
        },
      );
      void useAuthStore().refreshCurrentUser();

      await consumeRunStream(pageContext, abortController);
      schedulePersist();
    } catch (caught) {
      if (stopRequested.value || isAbortError(caught)) {
        if (!silentStopRequested.value) {
          markStopped();
          pushMessage(
            { messages: messages.value },
            {
              role: "assistant",
              kind: "text",
              content: "已终止当前回答。",
            },
          );
          schedulePersist();
        }
        return;
      }

      error.value = {
        code: "UNKNOWN_ERROR",
        message: caught instanceof Error ? caught.message : "Agent 运行失败。",
        retryable: true,
      };
      pushMessage(
        { messages: messages.value },
        {
          role: "assistant",
          kind: "error",
          content: error.value.message,
        },
      );
      schedulePersist();
    } finally {
      if (activeAbortController.value === abortController) {
        activeAbortController.value = null;
      }
      stopping.value = false;
      silentStopRequested.value = false;
      loading.value = false;
    }
  };

  const stop = async () => {
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
  };

  const executeAction = async (action: AgentAction) => {
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
          action,
        },
      })) as ActionExecutionResponse;

      const result: AgentActionResult = response.ok
        ? response.data
        : {
            actionId: action.id,
            status: "failed",
            message: response.error.message,
            error: response.error,
          };
      appendToolConversationMessage(action, result);
      schedulePersist();

      if (pendingAction.value?.id === action.id) {
        pendingAction.value = null;
      }
      updateActionMessage(
        { messages: messages.value },
        action.id,
        result.status === "succeeded" ? "confirmed" : "rejected",
      );
      applyEvent({ type: "action_result", runId: run.value.id, result });

      if (action.toolCallId) {
        await continueAfterToolResult(result);
      } else {
        applyEvent({
          type: "status",
          runId: run.value.id,
          status: result.status === "succeeded" ? "completed" : "failed",
        });
        await streamLocalAssistantText(
          result.status === "succeeded"
            ? "动作已完成。我会继续把执行结果保留在当前对话里。"
            : "动作没有成功执行，原因已经显示在上方。",
        );
      }
    } finally {
      stopping.value = false;
      silentStopRequested.value = false;
      loading.value = false;
      if (activeAbortController.value?.signal.aborted) {
        activeAbortController.value = null;
      }
    }
  };

  const executePendingAction = async () => {
    if (!pendingAction.value) {
      return;
    }

    await executeAction(pendingAction.value);
  };

  const rejectPendingAction = async () => {
    if (!pendingAction.value || !run.value) {
      return;
    }

    loading.value = true;
    const action = pendingAction.value;
    const result: AgentActionResult = {
      actionId: action.id,
      status: "skipped",
      message: "用户跳过了该动作。",
    };

    updateActionMessage({ messages: messages.value }, action.id, "rejected");
    appendToolConversationMessage(action, result);
    schedulePersist();
    pendingAction.value = null;
    applyEvent({ type: "action_result", runId: run.value.id, result });

    try {
      if (action.toolCallId) {
        await continueAfterToolResult(result);
      } else {
        applyEvent({
          type: "status",
          runId: run.value.id,
          status: "completed",
        });
        await streamLocalAssistantText("已跳过该动作。我不会修改当前网页。");
      }
    } finally {
      stopping.value = false;
      silentStopRequested.value = false;
      loading.value = false;
    }
  };

  const appendToolConversationMessage = (
    action: AgentAction,
    result: AgentActionResult,
  ) => {
    if (!action.toolCallId) {
      return;
    }

    modelConversation.value.push({
      role: "tool",
      tool_call_id: action.toolCallId,
      content: JSON.stringify({
        status: result.status,
        message: result.message,
        output: result.output ?? null,
        error: result.error?.message ?? null,
      }),
    });
  };

  return {
    run,
    plan,
    events,
    pendingAction,
    results,
    messages,
    modelConversation,
    activeSessionId,
    chatSessions,
    modelProviders,
    selectedModelRoute,
    modelLoading,
    modelError,
    historyLoading,
    historySaving,
    historyError,
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
    loadModels,
    setSelectedModelRoute,
    loadChatSessions,
    selectChatSession,
    removeChatSession,
    startNewChat,
    hydrateFromSnapshot,
    buildSnapshot,
    reset,
    clearForSignedOut,
  };
});
