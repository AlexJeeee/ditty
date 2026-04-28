<script setup lang="ts">
import { computed } from "vue";
import { usePageContextStore } from "../stores/page-context";

const pageContext = usePageContextStore();

const origin = computed(() => pageContext.context?.origin || "等待读取");
const summary = computed(() => pageContext.context?.visibleTextSummary || "点击刷新后读取当前网页的可见上下文。");
</script>

<template>
  <section class="panel-block page-context">
    <div class="section-heading">
      <div>
        <p class="eyebrow">当前页面</p>
        <h2>{{ pageContext.pageTitle }}</h2>
      </div>
      <button class="icon-button" type="button" title="刷新页面上下文" :disabled="pageContext.loading" @click="() => pageContext.refresh()">
        {{ pageContext.loading ? "读取中" : "刷新" }}
      </button>
    </div>

    <p class="muted single-line">{{ origin }}</p>
    <p class="summary-preview">{{ summary }}</p>

    <div class="metrics">
      <span>{{ pageContext.elementCount }} 个可交互元素</span>
      <span>{{ pageContext.context?.headings.length ?? 0 }} 个标题</span>
      <span>{{ pageContext.context?.tables.length ?? 0 }} 个表格</span>
    </div>

    <p v-if="pageContext.error" class="error-text">{{ pageContext.error.message }}</p>
  </section>
</template>
