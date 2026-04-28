<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
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
  type SelectionMenuAction
} from "@/shared/extension-messages";

const auth = useAuthStore();
const pageContext = usePageContextStore();
const agentRun = useAgentRunStore();
const composerGoal = ref("总结当前页面，并指出可以安全执行的下一步");
const handledSelectionActionId = ref("");

onMounted(() => {
  pageContext.refresh();
  consumePendingSelectionAction();
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  chrome.storage.onChanged.addListener(handleStorageChange);
});

onBeforeUnmount(() => {
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  chrome.storage.onChanged.removeListener(handleStorageChange);
});

async function start(goal: string, selectionPayload?: SelectionActionPayload) {
  await pageContext.refresh();

  if (selectionPayload) {
    pageContext.applySelectionAction(selectionPayload);
  }

  if (pageContext.context) {
    await agentRun.start(goal, pageContext.context);
  }
}

function createSelectionGoal(payload: SelectionActionPayload) {
  const text = payload.selectedText.trim();
  const source = payload.pageTitle || payload.pageUrl;
  const prompts: Record<SelectionMenuAction, string> = {
    translate: `请将以下网页选中文本翻译成自然、准确的中文，并保留关键信息。\n\n来源：${source}\n\n${text}`,
    explain: `请解释以下网页选中文本的含义，提炼重点，并在必要时补充背景。\n\n来源：${source}\n\n${text}`,
    add_to_chat: `请基于以下网页选中文本继续对话。\n\n来源：${source}\n\n${text}`
  };

  return prompts[payload.action];
}

async function handleSelectionAction(payload: SelectionActionPayload) {
  if (!payload.id || payload.id === handledSelectionActionId.value) {
    return;
  }

  handledSelectionActionId.value = payload.id;
  const goal = createSelectionGoal(payload);
  composerGoal.value = goal;

  await chrome.storage.local.remove(PENDING_SELECTION_ACTION_STORAGE_KEY);

  await pageContext.refresh();
  pageContext.applySelectionAction(payload);

  if (payload.action === "add_to_chat") {
    return;
  }

  await nextTick();
  await start(goal, payload);
}

async function consumePendingSelectionAction() {
  const result = await chrome.storage.local.get(PENDING_SELECTION_ACTION_STORAGE_KEY);
  const payload = result[PENDING_SELECTION_ACTION_STORAGE_KEY] as SelectionActionPayload | undefined;

  if (payload) {
    await handleSelectionAction(payload);
  }
}

function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string) {
  if (areaName !== "local") {
    return;
  }

  const change = changes[PENDING_SELECTION_ACTION_STORAGE_KEY];
  const payload = change?.newValue as SelectionActionPayload | undefined;

  if (payload) {
    void handleSelectionAction(payload);
  }
}

function handleRuntimeMessage(message: ExtensionMessage) {
  if (message.type !== "active_tab:changed") {
    return false;
  }

  void pageContext.refresh({ tabId: message.payload.tabId });
  return false;
}
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">Chrome AI Agent</p>
        <h1>网页执行工作台</h1>
      </div>
      <span class="status-dot" :class="{ online: auth.authenticated }" title="登录状态" />
    </header>

    <LoginPanel />
    <PageContextBar />
    <ChatPanel v-if="auth.authenticated" v-model="composerGoal" @submit="start" />
  </main>
</template>
