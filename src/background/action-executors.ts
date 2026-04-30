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

interface TabSnapshot {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  status?: chrome.tabs.Tab["status"];
}

interface PageActionMetadata {
  sourceTab?: TabSnapshot;
  targetTab?: TabSnapshot;
}

const delay = (ms: number) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const createActionResult = (
  action: AgentAction,
  status: AgentActionResult["status"],
  message: string,
  output?: unknown,
): AgentActionResult => {
  return {
    actionId: action.id,
    status,
    message,
    output,
  };
};

const toTabSnapshot = (tab?: chrome.tabs.Tab): TabSnapshot | undefined => {
  if (!tab) {
    return undefined;
  }

  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title,
    status: tab.status,
  };
};

const mergeActionOutput = (
  output: unknown,
  metadata: PageActionMetadata,
): Record<string, unknown> => {
  const outputRecord =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : {};

  return {
    ...outputRecord,
    pageAction: metadata,
  };
};

const waitForPostActionTargetTab = async (sourceTab?: chrome.tabs.Tab) => {
  const observedTabId = await new Promise<number | undefined>((resolve) => {
    let settled = false;

    const cleanup = () => {
      chrome.tabs.onCreated.removeListener(handleCreated);
      chrome.tabs.onActivated.removeListener(handleActivated);
      globalThis.clearTimeout(timeoutId);
    };

    const finish = (tabId?: number) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(tabId);
    };

    const handleCreated = (tab: chrome.tabs.Tab) => {
      if (
        typeof tab.id === "number" &&
        (!sourceTab?.windowId || tab.windowId === sourceTab.windowId)
      ) {
        finish(tab.id);
      }
    };

    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      if (
        activeInfo.tabId !== sourceTab?.id &&
        (!sourceTab?.windowId || activeInfo.windowId === sourceTab.windowId)
      ) {
        finish(activeInfo.tabId);
      }
    };

    const timeoutId = globalThis.setTimeout(() => finish(undefined), 1200);

    chrome.tabs.onCreated.addListener(handleCreated);
    chrome.tabs.onActivated.addListener(handleActivated);
  });

  await delay(300);

  if (typeof observedTabId === "number") {
    try {
      return await chrome.tabs.get(observedTabId);
    } catch {
      return getActiveTab();
    }
  }

  return getActiveTab();
};

const executeOpenUrlAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
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
};

const BROWSER_ACTION_EXECUTORS: Partial<
  Record<AgentToolName, BrowserActionExecutor>
> = {
  open_url: executeOpenUrlAction,
};

export const executeAgentAction = async (
  message: ExecuteActionMessage,
  dispatchPageAction: PageActionDispatcher,
): Promise<ActionExecutionResponse> => {
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
  if (browserExecutor) {
    return browserExecutor(action);
  }

  const sourceTab = await getActiveTab();
  const targetTabPromise = waitForPostActionTargetTab(sourceTab);
  const response = await dispatchPageAction(message);
  const targetTab = await targetTabPromise;

  if (!response.ok) {
    return response;
  }

  return {
    ok: true,
    data: {
      ...response.data,
      output: mergeActionOutput(response.data.output, {
        sourceTab: toTabSnapshot(sourceTab),
        targetTab: toTabSnapshot(targetTab),
      }),
    },
  };
};
