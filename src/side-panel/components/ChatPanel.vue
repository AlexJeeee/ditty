<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { renderMarkdown, splitThinkSections } from "@/shared/markdown";
import { useAgentRunStore, type ChatMessage } from "../stores/agent-run";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [goal: string];
  submit: [goal: string];
}>();

const agentRun = useAgentRunStore();
const logRef = ref<HTMLElement | null>(null);

function updateDraft(value: string) {
  emit("update:modelValue", value);
}

function submit() {
  const value = props.modelValue.trim();
  if (!value || !agentRun.canSend) {
    return;
  }

  emit("submit", value);
  emit("update:modelValue", "");
}

function messageLabel(message: ChatMessage) {
  if (message.role === "user") {
    return "你";
  }

  if (message.kind === "plan") {
    return "Agent 计划";
  }

  if (message.kind === "thinking") {
    return "Agent 思考";
  }

  if (message.kind === "action_confirmation") {
    return "动作确认";
  }

  if (message.kind === "result") {
    return "执行结果";
  }

  return "Agent";
}

function actionStatusText(message: ChatMessage) {
  const statusMap = {
    pending: "等待确认",
    executing: "执行中",
    confirmed: "已执行",
    rejected: "已跳过"
  };

  return message.actionStatus ? statusMap[message.actionStatus] : "等待确认";
}

function messageSections(message: ChatMessage) {
  return splitThinkSections(message.content).map((section, index) => ({
    ...section,
    id: `${message.id}_${index}`,
    html: renderMarkdown(section.content)
  }));
}

function scrollToBottom() {
  nextTick(() => {
    if (!logRef.value) {
      return;
    }

    logRef.value.scrollTo({
      top: logRef.value.scrollHeight,
      behavior: "smooth"
    });
  });
}

watch(
  () =>
    agentRun.messages
      .map((message) => `${message.id}:${message.content.length}:${message.streaming}:${message.actionStatus ?? ""}`)
      .join("|"),
  scrollToBottom,
  { flush: "post" }
);

onMounted(scrollToBottom);
</script>

<template>
  <section class="panel-block chat-panel">
    <div class="chat-header">
      <div>
        <p class="eyebrow">Chat</p>
        <h2>{{ agentRun.statusLabel }}</h2>
      </div>
      <button class="icon-button" type="button" title="清空对话" :disabled="!agentRun.messages.length" @click="agentRun.reset">
        清空
      </button>
    </div>

    <div ref="logRef" class="chat-log" aria-live="polite">
      <article
        v-for="message in agentRun.messages"
        :key="message.id"
        class="chat-message"
        :class="[`message-${message.role}`, `message-${message.kind}`]"
      >
        <div class="message-meta">
          <span>{{ messageLabel(message) }}</span>
          <span v-if="message.streaming" class="typing-dot">流式输出中</span>
        </div>

        <template v-if="message.kind === 'plan' && message.plan">
          <details class="collapsible-message">
            <summary>
              <span>查看计划</span>
              <small>{{ message.plan.steps.length }} 个步骤</small>
            </summary>
            <p class="message-text">{{ message.plan.summary }}</p>
            <ol class="plan-steps">
              <li v-for="step in message.plan.steps" :key="step.id">
                <strong>{{ step.toolName }}</strong>
                <span>{{ step.reason }}</span>
              </li>
            </ol>
            <div v-if="message.plan.blockedActions.length" class="blocked-actions">
              <strong>已阻断的高风险动作</strong>
              <p v-for="action in message.plan.blockedActions" :key="action.id">
                {{ action.target?.description ?? action.toolName }}：{{ action.reason }}
              </p>
            </div>
          </details>
        </template>

        <template v-else-if="message.kind === 'thinking'">
          <details class="collapsible-message" :open="message.streaming">
            <summary>
              <span>{{ message.streaming ? "正在思考" : "查看思考过程" }}</span>
              <small>{{ message.content.length }} 字</small>
            </summary>
            <div class="markdown-body" v-html="renderMarkdown(message.content)" />
          </details>
        </template>

        <template v-else-if="message.kind === 'action_confirmation' && message.action">
          <div class="action-card-inline">
            <div class="action-card-top">
              <div>
                <strong>{{ message.action.toolName }}</strong>
                <p>{{ message.content }}</p>
              </div>
              <span class="risk" :class="`risk-${message.action.riskLevel}`">{{ message.action.riskLevel }}</span>
            </div>
            <p v-if="message.action.target" class="muted">目标：{{ message.action.target.description }}</p>
            <div class="button-row">
              <button
                class="primary-button"
                type="button"
                :disabled="message.actionStatus !== 'pending' || agentRun.loading"
                @click="agentRun.executePendingAction"
              >
                {{ message.actionStatus === "executing" ? "执行中" : "执行" }}
              </button>
              <button
                class="secondary-button"
                type="button"
                :disabled="message.actionStatus !== 'pending' || agentRun.loading"
                @click="agentRun.rejectPendingAction"
              >
                跳过
              </button>
              <span class="action-status">{{ actionStatusText(message) }}</span>
            </div>
          </div>
        </template>

        <template v-else>
          <template v-for="section in messageSections(message)" :key="section.id">
            <details v-if="section.type === 'think'" class="collapsible-message think-section" :open="message.streaming">
              <summary>
                <span>{{ message.streaming ? "正在思考" : "查看思考过程" }}</span>
                <small>{{ section.content.length }} 字</small>
              </summary>
              <div class="markdown-body" v-html="section.html" />
            </details>
            <div v-else class="markdown-body" v-html="section.html" />
          </template>
        </template>
      </article>
    </div>

    <form class="chat-composer" @submit.prevent="submit">
      <textarea
        :value="modelValue"
        rows="3"
        placeholder="输入你想让 Agent 处理的任务"
        :disabled="agentRun.loading"
        @input="updateDraft(($event.target as HTMLTextAreaElement).value)"
        @keydown.enter.exact.prevent="submit"
      />
      <button class="primary-button" type="submit" :disabled="!modelValue.trim() || !agentRun.canSend">
        {{ agentRun.loading ? "生成中" : "发送" }}
      </button>
    </form>
  </section>
</template>
