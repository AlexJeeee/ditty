<script setup lang="ts">
import type { AgentAction } from "@/shared/types";

defineProps<{
  action: AgentAction;
  busy: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  reject: [];
}>();
</script>

<template>
  <section class="confirm-card">
    <div class="section-heading">
      <div>
        <p class="eyebrow">等待确认</p>
        <h3>{{ action.toolName }}</h3>
      </div>
      <span class="risk" :class="`risk-${action.riskLevel}`">{{ action.riskLevel }}</span>
    </div>
    <p>{{ action.reason }}</p>
    <p v-if="action.target" class="muted">目标：{{ action.target.description }}</p>
    <div class="button-row">
      <button class="primary-button" type="button" :disabled="busy" @click="emit('confirm')">
        {{ busy ? "执行中" : "执行" }}
      </button>
      <button class="secondary-button" type="button" :disabled="busy" @click="emit('reject')">跳过</button>
    </div>
  </section>
</template>
