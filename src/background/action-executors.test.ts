import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecuteActionMessage } from "@/shared/extension-messages";
import type { AgentAction } from "@/shared/types";
import { executeAgentAction } from "./action-executors";

const getActiveTabMock = vi.fn();

vi.mock("./tab-utils", () => ({
  getActiveTab: () => getActiveTabMock(),
}));

const createManageTabsMessage = (
  action: Partial<AgentAction>,
): ExecuteActionMessage => ({
  type: "agent_action:execute",
  payload: {
    runId: "run_tabs",
    action: {
      id: "action_tabs",
      toolName: "manage_tabs",
      riskLevel: "low",
      requiresConfirmation: false,
      reason: "测试标签页操作。",
      ...action,
    },
  },
});

describe("executeAgentAction manage_tabs", () => {
  const chromeMock = {
    tabs: {
      query: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      reload: vi.fn(),
      remove: vi.fn(),
      group: vi.fn(),
      ungroup: vi.fn(),
    },
    tabGroups: {
      query: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getActiveTabMock.mockResolvedValue({ id: 10, windowId: 1 });
    globalThis.chrome = chromeMock as unknown as typeof chrome;
  });

  it("lists tabs and groups in the current window", async () => {
    chromeMock.tabs.query.mockResolvedValue([
      {
        id: 10,
        windowId: 1,
        title: "Docs",
        url: "https://example.com/docs",
        active: true,
        pinned: false,
        groupId: 5,
        status: "complete",
      },
    ]);
    chromeMock.tabGroups.query.mockResolvedValue([
      {
        id: 5,
        windowId: 1,
        title: "资料",
        color: "blue",
        collapsed: false,
      },
    ]);

    const result = await executeAgentAction(
      createManageTabsMessage({
        input: { operation: "list_tabs" },
      }),
      vi.fn(),
    );

    expect(chromeMock.tabs.query).toHaveBeenCalledWith({
      currentWindow: true,
    });
    expect(chromeMock.tabGroups.query).toHaveBeenCalledWith({ windowId: 1 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.output).toEqual({
      tabs: [
        {
          id: 10,
          windowId: 1,
          title: "Docs",
          url: "https://example.com/docs",
          active: true,
          pinned: false,
          groupId: 5,
          status: "complete",
        },
      ],
      groups: [
        {
          id: 5,
          windowId: 1,
          title: "资料",
          color: "blue",
          collapsed: false,
        },
      ],
    });
  });

  it("switches to an explicit tab id without dispatching to the page", async () => {
    chromeMock.tabs.update.mockResolvedValue({
      id: 42,
      windowId: 1,
      title: "Target",
      url: "https://example.com",
      active: true,
    });

    const dispatchPageAction = vi.fn();
    const result = await executeAgentAction(
      createManageTabsMessage({
        input: { operation: "switch_tab", tabId: 42 },
      }),
      dispatchPageAction,
    );

    expect(chromeMock.tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(dispatchPageAction).not.toHaveBeenCalled();
    expect(result.ok && result.data.output).toEqual({
      tab: {
        id: 42,
        windowId: 1,
        title: "Target",
        url: "https://example.com",
        active: true,
      },
    });
  });

  it("creates a tab group and applies metadata", async () => {
    chromeMock.tabs.group.mockResolvedValue(7);
    chromeMock.tabGroups.update.mockResolvedValue({
      id: 7,
      windowId: 1,
      title: "资料",
      color: "blue",
      collapsed: true,
    });

    const result = await executeAgentAction(
      createManageTabsMessage({
        riskLevel: "medium",
        requiresConfirmation: true,
        input: {
          operation: "create_group",
          tabIds: [42, 43],
          title: "资料",
          color: "blue",
          collapsed: true,
        },
      }),
      vi.fn(),
    );

    expect(chromeMock.tabs.group).toHaveBeenCalledWith({ tabIds: [42, 43] });
    expect(chromeMock.tabGroups.update).toHaveBeenCalledWith(7, {
      title: "资料",
      color: "blue",
      collapsed: true,
    });
    expect(result.ok && result.data.output).toEqual({
      group: {
        id: 7,
        windowId: 1,
        title: "资料",
        color: "blue",
        collapsed: true,
      },
    });
  });
});
