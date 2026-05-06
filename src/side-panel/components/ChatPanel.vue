<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import ChatComposer from "./ChatComposer.vue";
import ChatMessageItem from "./ChatMessageItem.vue";
import { useAgentRunStore } from "../stores/agent-run";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [goal: string];
  submit: [goal: string];
}>();

const agentRun = useAgentRunStore();
const logRef = ref<HTMLElement | null>(null);
const historyStatus = computed(() => {
  if (agentRun.historyLoading) {
    return "加载中";
  }

  if (agentRun.historySaving) {
    return "保存中";
  }

  return `${agentRun.chatSessions.length} 条`;
});

const submit = () => {
  const value = props.modelValue.trim();
  if (!value || !agentRun.canSend) {
    return;
  }

  emit("submit", value);
  emit("update:modelValue", "");
};

const scrollToBottom = () => {
  nextTick(() => {
    if (!logRef.value) {
      return;
    }

    logRef.value.scrollTo({
      top: logRef.value.scrollHeight,
      behavior: "smooth",
    });
  });
};

const formatSessionTime = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const selectSession = (sessionId: string) => {
  void agentRun.selectChatSession(sessionId);
};

const removeSession = (sessionId: string, event: MouseEvent) => {
  event.stopPropagation();
  void agentRun.removeChatSession(sessionId);
};

watch(
  () =>
    agentRun.messages
      .map(
        (message) =>
          `${message.id}:${message.content.length}:${message.streaming}:${message.actionStatus ?? ""}`,
      )
      .join("|"),
  scrollToBottom,
  { flush: "post" },
);

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <section class="panel-block chat-panel">
    <aside class="chat-history">
      <div class="history-header">
        <div>
          <p class="eyebrow">History</p>
          <h2>{{ historyStatus }}</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          title="新建对话"
          @click="agentRun.startNewChat"
        >
          新建
        </button>
      </div>
      <p v-if="agentRun.historyError" class="error-text">
        {{ agentRun.historyError }}
      </p>
      <div class="history-list" aria-label="历史聊天">
        <div
          v-for="session in agentRun.chatSessions"
          :key="session.id"
          class="history-item"
          :class="{ active: session.id === agentRun.activeSessionId }"
        >
          <button
            class="history-select"
            type="button"
            @click="selectSession(session.id)"
          >
            <span class="history-title">{{ session.title }}</span>
            <span class="history-preview">
              {{ session.lastMessagePreview || session.pageTitle || "无消息" }}
            </span>
            <span class="history-meta">
              <span>{{ formatSessionTime(session.updatedAt) }}</span>
              <span>{{ session.messageCount }} 条消息</span>
            </span>
          </button>
          <button
            class="history-delete"
            type="button"
            title="删除历史"
            aria-label="删除历史"
            @click="removeSession(session.id, $event)"
          >
            ×
          </button>
        </div>
        <p
          v-if="!agentRun.historyLoading && !agentRun.chatSessions.length"
          class="history-empty"
        >
          暂无历史
        </p>
      </div>
    </aside>

    <div class="chat-main">
      <div class="chat-header">
        <div>
          <p class="eyebrow">Chat</p>
          <h2>{{ agentRun.statusLabel }}</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          title="新建对话"
          :disabled="agentRun.loading"
          @click="agentRun.startNewChat"
        >
          新建
        </button>
      </div>

      <div ref="logRef" class="chat-log" aria-live="polite">
        <ChatMessageItem
          v-for="message in agentRun.messages"
          :key="message.id"
          :message="message"
          :loading="agentRun.loading"
          @confirm-action="agentRun.executePendingAction"
          @reject-action="agentRun.rejectPendingAction"
        />
      </div>

      <ChatComposer
        :model-value="modelValue"
        :loading="agentRun.loading"
        :can-send="agentRun.canSend"
        :can-stop="agentRun.canStop"
        @update:model-value="emit('update:modelValue', $event)"
        @submit="submit"
        @stop="agentRun.stop"
      />
    </div>
  </section>
</template>
