import type {
  ActionExecutionResponse,
  ActiveTabChangedMessage,
  ExecuteActionMessage,
  ExtensionResponse,
  GetPageContextMessage,
  SelectionActionResponse,
  SelectionActionInvokeMessage,
  SelectionActionPayload,
  PageContextResponse,
} from "@/shared/extension-messages";
import { PENDING_SELECTION_ACTION_STORAGE_KEY } from "@/shared/extension-messages";
import { executeAgentAction } from "./action-executors";
import { getActiveTab, isTabUrlAccessible } from "./tab-utils";
import type {
  AgentActionResult,
  ExtensionError,
  PageContext,
} from "@/shared/types";

const PAGE_CONTEXT_RETRY_DELAYS = [0, 300, 500, 800, 1200, 1800];

const delay = (ms: number) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const getTargetTab = async (tabId?: number) => {
  if (typeof tabId === "number") {
    return chrome.tabs.get(tabId);
  }

  return getActiveTab();
};

const getOrigin = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null"
      ? `${parsed.protocol}//${parsed.hostname}`
      : parsed.origin;
  } catch {
    return url;
  }
};

const createFallbackPageContext = (tab: chrome.tabs.Tab): PageContext => {
  const url = tab.url || "";

  return {
    url,
    origin: url ? getOrigin(url) : "",
    title: tab.title || "当前浏览器页面",
    selectedText: "",
    visibleTextSummary:
      "当前页面不支持内容脚本读取，Agent 只能执行浏览器级工具。",
    headings: [],
    tables: [],
    interactiveElements: [],
    collectedAt: new Date().toISOString(),
  };
};

const normalizeTabStatus = (
  status: chrome.tabs.Tab["status"],
): ActiveTabChangedMessage["payload"]["status"] => {
  return status === "loading" || status === "complete" || status === "unloaded"
    ? status
    : undefined;
};

const toExtensionError = (error: unknown, fallback: string): ExtensionError => {
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : fallback,
    retryable: true,
  };
};

const sendToTab = async <T>(
  message: GetPageContextMessage | ExecuteActionMessage,
  tabId?: number,
): Promise<ExtensionResponse<T>> => {
  if (message.type === "page_context:get") {
    let lastResponse: ExtensionResponse<T> | null = null;

    for (const retryDelay of PAGE_CONTEXT_RETRY_DELAYS) {
      if (retryDelay > 0) {
        await delay(retryDelay);
      }

      lastResponse = await sendToTabOnce<T>(message, tabId);

      if (lastResponse.ok || !lastResponse.error.retryable) {
        return lastResponse;
      }
    }

    return (
      lastResponse ?? {
        ok: false,
        error: {
          code: "CONTENT_SCRIPT_UNAVAILABLE",
          message: "当前页面脚本未就绪，请稍后重试。",
          retryable: true,
        },
      }
    );
  }

  return sendToTabOnce<T>(message, tabId);
};

const sendToTabOnce = async <T>(
  message: GetPageContextMessage | ExecuteActionMessage,
  tabId?: number,
): Promise<ExtensionResponse<T>> => {
  const tab = await getTargetTab(tabId);

  if (!tab?.id || !tab.url || !isTabUrlAccessible(tab.url)) {
    return {
      ok: false,
      error: {
        code: "TAB_NOT_ACCESSIBLE",
        message: "当前页面不支持插件读取，请切换到普通网页后重试。",
        retryable: false,
      },
    };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "CONTENT_SCRIPT_UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "当前页面脚本未就绪，请刷新页面后重试。",
        retryable: true,
      },
    };
  }
};

const getPageContext = async (
  message: GetPageContextMessage,
): Promise<PageContextResponse> => {
  const tab = await getTargetTab(message.payload.tabId);

  if (!tab?.id || !tab.url || !isTabUrlAccessible(tab.url)) {
    return tab
      ? {
          ok: true,
          data: createFallbackPageContext(tab),
        }
      : {
          ok: false,
          error: {
            code: "TAB_NOT_ACCESSIBLE",
            message: "没有可读取的当前标签页。",
            retryable: true,
          },
        };
  }

  return sendToTab<PageContext>(message, tab.id);
};

const handleSelectionAction = async (
  message: SelectionActionInvokeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse<SelectionActionPayload>> => {
  const openSidePanelPromise = openAgentSidePanel(sender);
  const storeSelectionPromise = chrome.storage.local.set({
    [PENDING_SELECTION_ACTION_STORAGE_KEY]: message.payload,
  });

  const [openResult] = await Promise.allSettled([
    openSidePanelPromise,
    storeSelectionPromise,
  ]);

  if (openResult.status === "rejected") {
    console.warn(
      "Unable to open side panel from selection action.",
      openResult.reason,
    );
  }

  return {
    ok: true,
    data: message.payload,
  };
};

const openAgentSidePanel = (sender: chrome.runtime.MessageSender) => {
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (typeof tabId === "number") {
    return chrome.sidePanel.open({ tabId });
  }

  if (typeof windowId === "number") {
    return chrome.sidePanel.open({ windowId });
  }

  return Promise.resolve();
};

const notifyActiveTabChanged = async (tabId: number, windowId: number) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const message: ActiveTabChangedMessage = {
      type: "active_tab:changed",
      payload: {
        tabId,
        windowId,
        url: tab.url,
        title: tab.title,
        status: normalizeTabStatus(tab.status),
      },
    };

    await chrome.runtime.sendMessage(message);
  } catch {
    // The side panel may be closed; active tab tracking will refresh again when it opens.
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      // Older Chrome versions may not support this helper. action.onClicked below is the fallback.
    });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.windowId) {
    return;
  }

  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void notifyActiveTabChanged(activeInfo.tabId, activeInfo.windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || typeof tab.windowId !== "number") {
    return;
  }

  if (
    !changeInfo.url &&
    !changeInfo.title &&
    changeInfo.status !== "complete"
  ) {
    return;
  }

  void notifyActiveTabChanged(tabId, tab.windowId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "page_context:get") {
    getPageContext(message)
      .then((response: PageContextResponse) => sendResponse(response))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: toExtensionError(error, "页面上下文读取失败。"),
        }),
      );
    return true;
  }

  if (message.type === "agent_action:execute") {
    executeAgentAction(message, (actionMessage) =>
      sendToTab<AgentActionResult>(actionMessage),
    )
      .then((response: ActionExecutionResponse) => sendResponse(response))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: toExtensionError(error, "动作执行失败。"),
        }),
      );
    return true;
  }

  if (message.type === "selection_action:invoke") {
    handleSelectionAction(message, _sender)
      .then((response: SelectionActionResponse) => sendResponse(response))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: toExtensionError(error, "选中文本操作失败。"),
        }),
      );
    return true;
  }

  return false;
});
