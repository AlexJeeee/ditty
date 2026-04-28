import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { PageContextResponse, SelectionActionPayload } from "@/shared/extension-messages";
import type { ExtensionError, PageContext } from "@/shared/types";

export const usePageContextStore = defineStore("page-context", () => {
  const context = ref<PageContext | null>(null);
  const activeTabId = ref<number | null>(null);
  let refreshRequestId = 0;
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

  async function refresh(options: { tabId?: number } = {}) {
    const requestId = ++refreshRequestId;

    loading.value = true;
    error.value = null;

    try {
      const response = (await chrome.runtime.sendMessage({
        type: "page_context:get",
        payload: {
          includeSelection: true,
          includeInteractiveElements: true,
          tabId: options.tabId
        }
      })) as PageContextResponse;

      if (requestId !== refreshRequestId) {
        return context.value;
      }

      if (!response?.ok) {
        error.value = response?.error ?? {
          code: "UNKNOWN_ERROR",
          message: "页面上下文读取失败。",
          retryable: true
        };
        return null;
      }

      activeTabId.value = options.tabId ?? activeTabId.value;
      context.value = response.data;
      return context.value;
    } catch (caught) {
      if (requestId !== refreshRequestId) {
        return context.value;
      }

      error.value = {
        code: "UNKNOWN_ERROR",
        message: caught instanceof Error ? caught.message : "页面上下文读取失败。",
        retryable: true
      };
      return null;
    } finally {
      if (requestId === refreshRequestId) {
        loading.value = false;
      }
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
    activeTabId,
    loading,
    error,
    pageTitle,
    elementCount,
    refresh,
    applySelectionAction
  };
});
