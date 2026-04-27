<script setup lang="ts">
import { computed } from "vue";

const emit = defineEmits<{
  "update:modelValue": [goal: string];
  submit: [goal: string];
}>();

const props = defineProps<{
  modelValue: string;
}>();

const goal = computed({
  get: () => props.modelValue,
  set: (value: string) => emit("update:modelValue", value)
});

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
