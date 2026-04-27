<script setup lang="ts">
import ActionConfirmCard from "./ActionConfirmCard.vue";
import { useAgentRunStore } from "../stores/agent-run";

const agentRun = useAgentRunStore();
</script>

<template>
  <section class="panel-block run-panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Agent</p>
        <h2>{{ agentRun.run?.status ?? "idle" }}</h2>
      </div>
      <button class="icon-button" type="button" title="清空任务" :disabled="!agentRun.hasRun" @click="agentRun.reset">
        清空
      </button>
    </div>

    <p v-if="!agentRun.hasRun" class="muted">Agent 计划和动作确认会显示在这里。</p>
    <p v-if="agentRun.error" class="error-text">{{ agentRun.error.message }}</p>

    <div v-if="agentRun.plan" class="plan">
      <p>{{ agentRun.plan.summary }}</p>
      <ol>
        <li v-for="step in agentRun.plan.steps" :key="step.id">
          <span>{{ step.toolName }}</span>
          <small>{{ step.reason }}</small>
        </li>
      </ol>
      <div v-if="agentRun.plan.blockedActions.length" class="blocked-list">
        <strong>已阻断的高风险动作</strong>
        <p v-for="action in agentRun.plan.blockedActions" :key="action.id">{{ action.target?.description }}：{{ action.reason }}</p>
      </div>
    </div>

    <ActionConfirmCard
      v-if="agentRun.pendingAction"
      :action="agentRun.pendingAction"
      :busy="agentRun.loading"
      @confirm="agentRun.executePendingAction"
      @reject="agentRun.rejectPendingAction"
    />

    <div v-if="agentRun.results.length" class="results">
      <strong>执行结果</strong>
      <p v-for="result in agentRun.results" :key="result.actionId" :class="`result-${result.status}`">
        {{ result.status }}：{{ result.message }}
      </p>
    </div>

    <div v-if="agentRun.events.length" class="event-log">
      <strong>事件流</strong>
      <p v-for="(event, index) in agentRun.events" :key="index">{{ event.type }}</p>
    </div>
  </section>
</template>
