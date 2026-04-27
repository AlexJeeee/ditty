<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  submit: [goal: string];
}>();

const goal = ref("总结当前页面，并指出可以安全执行的下一步");

function submit() {
  const value = goal.value.trim();
  if (value) {
    emit("submit", value);
  }
}
</script>

<template>
  <section class="panel-block task-composer">
    <label for="goal">任务</label>
    <textarea id="goal" v-model="goal" rows="4" placeholder="告诉 Agent 你想完成什么" />
    <button class="primary-button" type="button" @click="submit">开始分析</button>
  </section>
</template>
