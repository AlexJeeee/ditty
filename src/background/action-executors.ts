import type {
  ActionExecutionResponse,
  ExecuteActionMessage,
} from "@/shared/extension-messages";
import { normalizeHttpUrl } from "@/shared/url-action";
import { getActiveTab } from "./tab-utils";
import type {
  AgentAction,
  AgentActionResult,
  AgentToolName,
} from "@/shared/types";

type BrowserActionExecutor = (
  action: AgentAction,
) => Promise<ActionExecutionResponse>;
type PageActionDispatcher = (
  message: ExecuteActionMessage,
) => Promise<ActionExecutionResponse>;

function createActionResult(
  action: AgentAction,
  status: AgentActionResult["status"],
  message: string,
  output?: unknown,
): AgentActionResult {
  return {
    actionId: action.id,
    status,
    message,
    output,
  };
}

async function executeOpenUrlAction(
  action: AgentAction,
): Promise<ActionExecutionResponse> {
  const rawUrl =
    action.input?.url ??
    action.input?.value ??
    action.input?.text ??
    action.target?.description ??
    "";
  const normalized = normalizeHttpUrl(rawUrl);

  if (!normalized.ok) {
    return {
      ok: true,
      data: createActionResult(action, "blocked", normalized.message),
    };
  }

  const activeTab = await getActiveTab();
  const createProperties: chrome.tabs.CreateProperties = {
    active: true,
    url: normalized.url,
  };

  if (typeof activeTab?.windowId === "number") {
    createProperties.windowId = activeTab.windowId;
  }

  if (typeof activeTab?.id === "number") {
    createProperties.openerTabId = activeTab.id;
  }

  const createdTab = await chrome.tabs.create(createProperties);

  return {
    ok: true,
    data: createActionResult(
      action,
      "succeeded",
      `已打开新标签页：${normalized.url}`,
      {
        tabId: createdTab.id,
        url: normalized.url,
      },
    ),
  };
}

const BROWSER_ACTION_EXECUTORS: Partial<
  Record<AgentToolName, BrowserActionExecutor>
> = {
  open_url: executeOpenUrlAction,
};

export async function executeAgentAction(
  message: ExecuteActionMessage,
  dispatchPageAction: PageActionDispatcher,
): Promise<ActionExecutionResponse> {
  const action = message.payload.action;

  if (action.riskLevel === "high") {
    return {
      ok: true,
      data: createActionResult(
        action,
        "blocked",
        "高风险动作已被本地策略阻断。",
      ),
    };
  }

  const browserExecutor = BROWSER_ACTION_EXECUTORS[action.toolName];
  return browserExecutor
    ? browserExecutor(action)
    : dispatchPageAction(message);
}
