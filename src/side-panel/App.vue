<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import ChatPanel from "./components/ChatPanel.vue";
import LoginPanel from "./components/LoginPanel.vue";
import PageContextBar from "./components/PageContextBar.vue";
import { useAgentRunStore } from "./stores/agent-run";
import { useAuthStore } from "./stores/auth";
import { usePageContextStore } from "./stores/page-context";
import {
  PENDING_SELECTION_ACTION_STORAGE_KEY,
  type ExtensionMessage,
  type SelectionActionPayload,
  type SelectionMenuAction,
} from "@/shared/extension-messages";

const auth = useAuthStore();
const pageContext = usePageContextStore();
const agentRun = useAgentRunStore();
const composerGoal = ref("");
const handledSelectionActionId = ref("");

onMounted(async () => {
  await auth.initialize();

  pageContext.refresh();
  consumePendingSelectionAction();
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.storage.onChanged.addListener(handleStorageChange);
});

watch(
  () => auth.authenticated,
  (authenticated) => {
    if (authenticated) {
      void agentRun.loadChatSessions();
      return;
    }

    agentRun.clearForSignedOut();
  },
);

onBeforeUnmount(() => {
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  chrome.storage.onChanged.removeListener(handleStorageChange);
});

const start = async (
  goal: string,
  selectionPayload?: SelectionActionPayload,
) => {
  await pageContext.refresh();

  if (selectionPayload) {
    pageContext.applySelectionAction(selectionPayload);
  }

  if (pageContext.context) {
    await agentRun.start(goal, pageContext.context);
  }
};

const createSelectionGoal = (payload: SelectionActionPayload) => {
  const text = payload.selectedText.trim();
  const prompts: Record<SelectionMenuAction, string> = {
    translate: `请将以下网页选中文本翻译成自然、准确的中文，并保留关键信息。\n\n${text}`,
    explain: `请解释以下网页选中文本的含义，提炼重点，并在必要时补充背景。\n\n${text}`,
    add_to_chat: `请基于以下网页选中文本继续对话。\n\n${text}`,
  };

  return prompts[payload.action];
};

const handleSelectionAction = async (payload: SelectionActionPayload) => {
  if (!payload.id || payload.id === handledSelectionActionId.value) {
    return;
  }

  handledSelectionActionId.value = payload.id;
  const goal = createSelectionGoal(payload);

  await chrome.storage.local.remove(PENDING_SELECTION_ACTION_STORAGE_KEY);

  if (!auth.authenticated) {
    composerGoal.value = goal;
    return;
  }

  await pageContext.refresh();
  pageContext.applySelectionAction(payload);

  if (payload.action === "add_to_chat") {
    composerGoal.value = goal;
    return;
  }

  await nextTick();
  await start(goal, payload);
};

const consumePendingSelectionAction = async () => {
  const result = await chrome.storage.local.get(
    PENDING_SELECTION_ACTION_STORAGE_KEY,
  );
  const payload = result[PENDING_SELECTION_ACTION_STORAGE_KEY] as
    | SelectionActionPayload
    | undefined;

  if (payload) {
    await handleSelectionAction(payload);
  }
};

const handleStorageChange = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => {
  if (areaName !== "local") {
    return;
  }

  const change = changes[PENDING_SELECTION_ACTION_STORAGE_KEY];
  const payload = change?.newValue as SelectionActionPayload | undefined;

  if (payload) {
    void handleSelectionAction(payload);
  }
};

const handleRuntimeMessage = (message: ExtensionMessage) => {
  if (message.type !== "active_tab:changed") {
    return false;
  }

  void pageContext.refresh({ tabId: message.payload.tabId });
  return false;
};
</script>

<template>
  <main class="app-shell">
    <LoginPanel />
    <PageContextBar />
    <ChatPanel
      v-if="auth.authenticated"
      v-model="composerGoal"
      @submit="start"
    />
  </main>
</template>
