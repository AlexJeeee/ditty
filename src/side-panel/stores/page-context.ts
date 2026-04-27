import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { PageContextResponse, SelectionActionPayload } from "@/shared/extension-messages";
import type { ExtensionError, PageContext } from "@/shared/types";

export const usePageContextStore = defineStore("page-context", () => {
  const context = ref<PageContext | null>(null);
  const loading = ref(false);
  const error = ref<ExtensionError | null>(null);

  const pageTitle = computed(() => context.value?.title || "未读取页面");
  const elementCount = computed(() => context.value?.interactiveElements.length ?? 0);

  function getOrigin(url: string, fallback: string) {
    try {
      return new URL(url).origin;
    } catch {
      return fallback;
    }
  }

  async function refresh() {
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
      if (!response?.ok) {
        error.value = response?.error ?? {
          code: "UNKNOWN_ERROR",
          message: "页面上下文读取失败。",
          retryable: true
        };
        return null;
      }

      context.value = response.data;
      return context.value;
    } catch (caught) {
      error.value = {
        code: "UNKNOWN_ERROR",
        message: caught instanceof Error ? caught.message : "页面上下文读取失败。",
        retryable: true
      };
      return null;
    } finally {
      loading.value = false;
    }
  }

  function applySelectionAction(payload: SelectionActionPayload) {
    const selectedText = payload.selectedText.trim();

    if (!selectedText) {
      return;
    }

    if (context.value) {
      context.value = {
        ...context.value,
        url: payload.pageUrl || context.value.url,
        origin: payload.pageUrl ? getOrigin(payload.pageUrl, context.value.origin) : context.value.origin,
        title: payload.pageTitle || context.value.title,
        selectedText,
        collectedAt: payload.requestedAt
      };
    }
  }

  return {
    context,
    loading,
    error,
    pageTitle,
    elementCount,
    refresh,
    applySelectionAction
  };
});
