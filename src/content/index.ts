import { collectPageContext } from "./collect-page-context";
import { executeAction } from "./execute-action";
import { setupSelectionMenu } from "./selection-menu";
import type { ExtensionMessage } from "@/shared/extension-messages";

setupSelectionMenu();

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "page_context:get") {
    try {
      sendResponse({ ok: true, data: collectPageContext() });
    } catch (error) {
      sendResponse({
        ok: false,
        error: {
          code: "PAGE_CONTEXT_BLOCKED",
          message: error instanceof Error ? error.message : "无法读取当前页面上下文。",
          retryable: true
        }
      });
    }
    return true;
  }

  if (message.type === "agent_action:execute") {
    executeAction(message.payload.action)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: {
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "动作执行失败。",
            retryable: true
          }
        })
      );
    return true;
  }

  return false;
});
