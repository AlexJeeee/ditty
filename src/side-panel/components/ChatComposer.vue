<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: string;
  loading: boolean;
  canSend: boolean;
  canStop: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [goal: string];
  submit: [goal: string];
  stop: [];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isComposing = ref(false);

function resizeTextarea(textarea = textareaRef.value) {
  if (!textarea) {
    return;
  }

  textarea.style.height = "auto";
  const maxHeight = Number.parseFloat(
    window.getComputedStyle(textarea).maxHeight,
  );
  const nextHeight = Number.isFinite(maxHeight)
    ? Math.min(textarea.scrollHeight, maxHeight)
    : textarea.scrollHeight;
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > nextHeight ? "auto" : "hidden";
}

function handleInput(event: Event) {
  const textarea = event.target as HTMLTextAreaElement;
  emit("update:modelValue", textarea.value);
  resizeTextarea(textarea);
}

function submit() {
  const value = props.modelValue.trim();
  if (!value || !props.canSend) {
    return;
  }

  emit("submit", value);
  emit("update:modelValue", "");
}

function handleEnterKeydown(event: KeyboardEvent) {
  if (isComposing.value || event.isComposing || event.keyCode === 229) {
    return;
  }

  event.preventDefault();
  submit();
}

function handleActionClick() {
  if (props.loading) {
    emit("stop");
  }
}

watch(
  () => props.modelValue,
  () => nextTick(() => resizeTextarea()),
  { flush: "post" },
);

onMounted(() => resizeTextarea());
</script>

<template>
  <form class="chat-composer" @submit.prevent="submit">
    <div class="composer-surface">
      <textarea
        ref="textareaRef"
        :value="modelValue"
        rows="2"
        placeholder="输入你想让 Agent 处理的任务"
        :disabled="loading"
        @input="handleInput"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
        @keydown.enter.exact="handleEnterKeydown"
      />
      <div class="composer-toolbar">
        <button
          class="composer-tool-button composer-plus-button"
          type="button"
          title="添加内容"
          aria-label="添加内容"
        >
          <span aria-hidden="true">+</span>
        </button>
        <div class="composer-actions">
          <button
            class="composer-tool-button"
            type="button"
            title="语音输入"
            aria-label="语音输入"
          >
            <span class="mic-icon" aria-hidden="true" />
          </button>
          <button
            class="composer-action-button"
            :class="{ 'composer-action-stop': loading }"
            :type="loading ? 'button' : 'submit'"
            :title="loading ? '终止当前回答' : '发送'"
            :aria-label="loading ? '终止当前回答' : '发送'"
            :disabled="loading ? !canStop : !modelValue.trim() || !canSend"
            @click="handleActionClick"
          >
            <span v-if="loading" class="stop-square" aria-hidden="true" />
            <span v-else class="send-arrow" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </form>
</template>
