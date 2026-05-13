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
  active?: boolean;
  pinned?: boolean;
  groupId?: number;
}

interface TabGroupSnapshot {
  id: number;
  windowId: number;
  title?: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
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
    ...(typeof tab.id === "number" ? { id: tab.id } : {}),
    ...(typeof tab.windowId === "number" ? { windowId: tab.windowId } : {}),
    ...(tab.url ? { url: tab.url } : {}),
    ...(tab.title ? { title: tab.title } : {}),
    ...(tab.status ? { status: tab.status } : {}),
    ...(typeof tab.active === "boolean" ? { active: tab.active } : {}),
    ...(typeof tab.pinned === "boolean" ? { pinned: tab.pinned } : {}),
    ...(typeof tab.groupId === "number" ? { groupId: tab.groupId } : {}),
  };
};

const toTabGroupSnapshot = (
  group: chrome.tabGroups.TabGroup,
): TabGroupSnapshot => {
  return {
    id: group.id,
    windowId: group.windowId,
    ...(group.title ? { title: group.title } : {}),
    color: group.color,
    collapsed: group.collapsed,
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

const createBlockedActionResponse = (
  action: AgentAction,
  message: string,
): ActionExecutionResponse => ({
  ok: true,
  data: createActionResult(action, "blocked", message),
});

const getTabId = (action: AgentAction) => {
  return typeof action.input?.tabId === "number" ? action.input.tabId : null;
};

const getTabIds = (action: AgentAction) => {
  const tabIds = action.input?.tabIds;
  return Array.isArray(tabIds) && tabIds.length > 0 ? tabIds : null;
};

const getGroupId = (action: AgentAction) => {
  return typeof action.input?.groupId === "number"
    ? action.input.groupId
    : null;
};

const createGroupUpdateProperties = (
  action: AgentAction,
): chrome.tabGroups.UpdateProperties | null => {
  const updateProperties: chrome.tabGroups.UpdateProperties = {};

  if (action.input?.title) {
    updateProperties.title = action.input.title;
  }

  if (action.input?.color) {
    updateProperties.color = action.input.color;
  }

  if (typeof action.input?.collapsed === "boolean") {
    updateProperties.collapsed = action.input.collapsed;
  }

  return Object.keys(updateProperties).length ? updateProperties : null;
};

const executeListTabsAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const activeTab = await getActiveTab();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groupQuery =
    typeof activeTab?.windowId === "number"
      ? { windowId: activeTab.windowId }
      : {};
  const groups = await chrome.tabGroups.query(groupQuery);

  return {
    ok: true,
    data: createActionResult(action, "succeeded", "已读取当前窗口标签页。", {
      tabs: tabs.map(toTabSnapshot).filter(Boolean),
      groups: groups.map(toTabGroupSnapshot),
    }),
  };
};

const executeSwitchTabAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const tabId = getTabId(action);

  if (tabId === null) {
    return createBlockedActionResponse(action, "缺少要切换的标签页 id。");
  }

  const tab = await chrome.tabs.update(tabId, { active: true });

  return {
    ok: true,
    data: createActionResult(action, "succeeded", `已切换到标签页 ${tabId}。`, {
      tab: toTabSnapshot(tab),
    }),
  };
};

const executeReloadTabAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const tabId = getTabId(action);

  if (tabId === null) {
    return createBlockedActionResponse(action, "缺少要刷新的标签页 id。");
  }

  await chrome.tabs.reload(tabId);
  const tab = await chrome.tabs.get(tabId);

  return {
    ok: true,
    data: createActionResult(action, "succeeded", `已刷新标签页 ${tabId}。`, {
      tab: toTabSnapshot(tab),
    }),
  };
};

const executeCloseTabAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const tabIds = getTabIds(action);

  if (!tabIds) {
    return createBlockedActionResponse(action, "缺少要关闭的标签页 id。");
  }

  await chrome.tabs.remove(tabIds);

  return {
    ok: true,
    data: createActionResult(
      action,
      "succeeded",
      `已关闭 ${tabIds.length} 个标签页。`,
      { tabIds },
    ),
  };
};

const executeCreateGroupAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const tabIds = getTabIds(action);

  if (!tabIds) {
    return createBlockedActionResponse(action, "缺少要分组的标签页 id。");
  }

  const groupId = await chrome.tabs.group({ tabIds });
  const updateProperties = createGroupUpdateProperties(action);
  const group = updateProperties
    ? await chrome.tabGroups.update(groupId, updateProperties)
    : await chrome.tabGroups.get(groupId);

  return {
    ok: true,
    data: createActionResult(
      action,
      "succeeded",
      `已创建标签页分组 ${groupId}。`,
      {
        group: toTabGroupSnapshot(group),
      },
    ),
  };
};

const executeUpdateGroupAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const groupId = getGroupId(action);
  const updateProperties = createGroupUpdateProperties(action);

  if (groupId === null || !updateProperties) {
    return createBlockedActionResponse(
      action,
      "缺少要更新的分组 id 或更新内容。",
    );
  }

  const group = await chrome.tabGroups.update(groupId, updateProperties);

  return {
    ok: true,
    data: createActionResult(
      action,
      "succeeded",
      `已更新标签页分组 ${groupId}。`,
      {
        group: toTabGroupSnapshot(group),
      },
    ),
  };
};

const executeMoveTabsToGroupAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const groupId = getGroupId(action);
  const tabIds = getTabIds(action);

  if (groupId === null || !tabIds) {
    return createBlockedActionResponse(action, "缺少目标分组 id 或标签页 id。");
  }

  const updatedGroupId = await chrome.tabs.group({ groupId, tabIds });
  const group = await chrome.tabGroups.get(updatedGroupId);

  return {
    ok: true,
    data: createActionResult(
      action,
      "succeeded",
      `已将 ${tabIds.length} 个标签页移入分组 ${updatedGroupId}。`,
      {
        group: toTabGroupSnapshot(group),
        tabIds,
      },
    ),
  };
};

const executeUngroupTabsAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  const tabIds = getTabIds(action);

  if (!tabIds) {
    return createBlockedActionResponse(action, "缺少要移出分组的标签页 id。");
  }

  await chrome.tabs.ungroup(tabIds);

  return {
    ok: true,
    data: createActionResult(
      action,
      "succeeded",
      `已将 ${tabIds.length} 个标签页移出分组。`,
      { tabIds },
    ),
  };
};

const executeManageTabsAction = async (
  action: AgentAction,
): Promise<ActionExecutionResponse> => {
  switch (action.input?.operation) {
    case "list_tabs":
      return executeListTabsAction(action);
    case "switch_tab":
      return executeSwitchTabAction(action);
    case "reload_tab":
      return executeReloadTabAction(action);
    case "close_tab":
      return executeCloseTabAction(action);
    case "create_group":
      return executeCreateGroupAction(action);
    case "update_group":
      return executeUpdateGroupAction(action);
    case "move_tabs_to_group":
      return executeMoveTabsToGroupAction(action);
    case "ungroup_tabs":
      return executeUngroupTabsAction(action);
    default:
      return createBlockedActionResponse(action, "不支持的标签页操作。");
  }
};

const BROWSER_ACTION_EXECUTORS: Partial<
  Record<AgentToolName, BrowserActionExecutor>
> = {
  open_url: executeOpenUrlAction,
  manage_tabs: executeManageTabsAction,
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
