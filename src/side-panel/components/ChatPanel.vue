<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
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
    <div class="chat-header">
      <div>
        <p class="eyebrow">Chat</p>
        <h2>{{ agentRun.statusLabel }}</h2>
      </div>
      <button
        class="icon-button"
        type="button"
        title="清空对话"
        :disabled="!agentRun.messages.length"
        @click="agentRun.reset"
      >
        清空
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
  </section>
</template>
