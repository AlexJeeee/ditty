import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { PageContextResponse } from "@/shared/extension-messages";
import type { ExtensionError, PageContext } from "@/shared/types";

export const usePageContextStore = defineStore("page-context", () => {
  const context = ref<PageContext | null>(null);
  const loading = ref(false);
  const error = ref<ExtensionError | null>(null);

  const pageTitle = computed(() => context.value?.title || "未读取页面");
  const elementCount = computed(() => context.value?.interactiveElements.length ?? 0);

  async function refresh() {
    console.log("refresh");
    loading.value = true;
    error.value = null;

    try {
      const response = (await chrome.runtime.sendMessage({
        type: "page_context:get",
        payload: {
          includeSelection: true,
          includeInteractiveElements: true
        }
      })) as PageContextResponse;
      console.log(response);

      if (!response?.ok) {
        error.value = response?.error ?? {
          code: "UNKNOWN_ERROR",
          message: "页面上下文读取失败。",
          retryable: true
        };
        return;
      }

      context.value = response.data;
    } catch (caught) {
      console.log(caught,"caught");
      error.value = {
        code: "UNKNOWN_ERROR",
        message: caught instanceof Error ? caught.message : "页面上下文读取失败。",
        retryable: true
      };
    } finally {
      loading.value = false;
    }
  }

  return {
    context,
    loading,
    error,
    pageTitle,
    elementCount,
    refresh
  };
});
