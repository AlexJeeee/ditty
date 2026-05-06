<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown, splitThinkSections } from "@/shared/markdown";
import type { ChatMessage } from "@/shared/types";

const props = defineProps<{
  message: ChatMessage;
  loading: boolean;
}>();

const emit = defineEmits<{
  "confirm-action": [];
  "reject-action": [];
}>();

const label = computed(() => {
  if (props.message.role === "user") {
    return "你";
  }

  if (props.message.kind === "plan") {
    return "Agent 计划";
  }

  if (props.message.kind === "thinking") {
    return "Agent 思考";
  }

  if (props.message.kind === "action_confirmation") {
    return props.message.action?.requiresConfirmation ? "动作确认" : "工具动作";
  }

  if (props.message.kind === "result") {
    return "执行结果";
  }

  return "Agent";
});

const actionStatusText = computed(() => {
  const statusMap = {
    pending: "等待确认",
    executing: "执行中",
    confirmed: "已执行",
    rejected: "已跳过",
  };

  return props.message.actionStatus
    ? statusMap[props.message.actionStatus]
    : "等待确认";
});

const sections = computed(() =>
  splitThinkSections(props.message.content).map((section, index) => ({
    ...section,
    id: `${props.message.id}_${index}`,
    html: renderMarkdown(section.content),
  })),
);
</script>

<template>
  <article
    class="chat-message"
    :class="[`message-${message.role}`, `message-${message.kind}`]"
  >
    <div class="message-meta">
      <span>{{ label }}</span>
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
            {{ action.target?.description ?? action.toolName }}：{{
              action.reason
            }}
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

    <template
      v-else-if="message.kind === 'action_confirmation' && message.action"
    >
      <div class="action-card-inline">
        <div class="action-card-top">
          <div>
            <strong>{{ message.action.toolName }}</strong>
            <p>{{ message.content }}</p>
          </div>
          <span class="risk" :class="`risk-${message.action.riskLevel}`">{{
            message.action.riskLevel
          }}</span>
        </div>
        <p v-if="message.action.target" class="muted">
          目标：{{ message.action.target.description }}
        </p>
        <div v-if="message.action.requiresConfirmation" class="button-row">
          <button
            class="primary-button"
            type="button"
            :disabled="message.actionStatus !== 'pending' || loading"
            @click="emit('confirm-action')"
          >
            {{ message.actionStatus === "executing" ? "执行中" : "执行" }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="message.actionStatus !== 'pending' || loading"
            @click="emit('reject-action')"
          >
            跳过
          </button>
          <span class="action-status">{{ actionStatusText }}</span>
        </div>
        <p v-else class="action-status">{{ actionStatusText }}</p>
      </div>
    </template>

    <template v-else>
      <template v-for="section in sections" :key="section.id">
        <details
          v-if="section.type === 'think'"
          class="collapsible-message think-section"
          :open="message.streaming"
        >
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
</template>
