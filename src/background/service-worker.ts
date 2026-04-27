import type {
  ActionExecutionResponse,
  ExecuteActionMessage,
  ExtensionResponse,
  GetPageContextMessage,
  PageContextResponse
} from "@/shared/extension-messages";
import type { AgentActionResult, ExtensionError, PageContext } from "@/shared/types";

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function toExtensionError(error: unknown, fallback: string): ExtensionError {
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : fallback,
    retryable: true
  };
}

async function sendToActiveTab<T>(message: GetPageContextMessage | ExecuteActionMessage): Promise<ExtensionResponse<T>> {
  const tab = await getActiveTab();
  console.log(tab,"tab");

  if (!tab?.id || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return {
      ok: false,
      error: {
        code: "TAB_NOT_ACCESSIBLE",
        message: "当前页面不支持插件读取，请切换到普通网页后重试。",
        retryable: false
      }
    };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "CONTENT_SCRIPT_UNAVAILABLE",
        message: error instanceof Error ? error.message : "当前页面脚本未就绪，请刷新页面后重试。",
        retryable: true
      }
    };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Older Chrome versions may not support this helper. action.onClicked below is the fallback.
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.windowId) {
    return;
  }

  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "page_context:get") {
    sendToActiveTab<PageContext>(message)
      .then((response: PageContextResponse) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: toExtensionError(error, "页面上下文读取失败。") }));
    return true;
  }

  if (message.type === "agent_action:execute") {
    sendToActiveTab<AgentActionResult>(message)
      .then((response: ActionExecutionResponse) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: toExtensionError(error, "动作执行失败。") }));
    return true;
  }

  return false;
});
