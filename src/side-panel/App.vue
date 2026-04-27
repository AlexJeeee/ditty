<script setup lang="ts">
import { onMounted } from "vue";
import AgentRunPanel from "./components/AgentRunPanel.vue";
import LoginPanel from "./components/LoginPanel.vue";
import PageContextBar from "./components/PageContextBar.vue";
import TaskComposer from "./components/TaskComposer.vue";
import { useAgentRunStore } from "./stores/agent-run";
import { useAuthStore } from "./stores/auth";
import { usePageContextStore } from "./stores/page-context";

const auth = useAuthStore();
const pageContext = usePageContextStore();
const agentRun = useAgentRunStore();

onMounted(() => {
  pageContext.refresh();
});

async function start(goal: string) {
  if (!pageContext.context) {
    await pageContext.refresh();
  }

  if (pageContext.context) {
    await agentRun.start(goal, pageContext.context);
  }
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
    <TaskComposer v-if="auth.authenticated" @submit="start" />
    <AgentRunPanel />
  </main>
</template>
