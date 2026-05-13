import { describe, expect, it } from "vitest";
import { createActionFromToolCall } from "./model-tools";

describe("createActionFromToolCall", () => {
  it("creates a direct click action for a collected DOM element", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_1",
        index: 0,
        name: "click_element",
        arguments: JSON.stringify({
          element_id: "el_1_abcde",
          description: "搜索按钮",
          reason: "用户要求点击搜索按钮。",
        }),
      },
      "action_1",
    );

    expect(result.action).toEqual({
      id: "action_1",
      toolCallId: "tool_1",
      toolName: "click_element",
      riskLevel: "medium",
      requiresConfirmation: false,
      target: {
        elementId: "el_1_abcde",
        description: "搜索按钮",
      },
      reason: "用户要求点击搜索按钮。",
    });
  });

  it("blocks click actions without a valid collected element id", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_1",
        index: 0,
        name: "click_element",
        arguments: JSON.stringify({
          element_id: "   ",
          description: "空目标",
          reason: "尝试点击空目标。",
        }),
      },
      "action_1",
    );

    expect(result.action).toBeUndefined();
    expect(result.blockedReason).toBe(
      "模型请求 click_element，但参数格式未通过校验。",
    );
  });

  it("creates a direct fill action for a collected input", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_2",
        index: 0,
        name: "fill_input",
        arguments: JSON.stringify({
          element_id: "el_2_fghij",
          value: "明天天气",
          description: "搜索框",
          reason: "用户要求查询明天天气，需要先填写搜索关键词。",
        }),
      },
      "action_2",
    );

    expect(result.action).toEqual({
      id: "action_2",
      toolCallId: "tool_2",
      toolName: "fill_input",
      riskLevel: "medium",
      requiresConfirmation: false,
      target: {
        elementId: "el_2_fghij",
        description: "搜索框",
      },
      input: {
        value: "明天天气",
      },
      reason: "用户要求查询明天天气，需要先填写搜索关键词。",
    });
  });

  it("allows fill actions with an empty value for clearing an input", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_3",
        index: 0,
        name: "fill_input",
        arguments: JSON.stringify({
          element_id: "el_3_klmno",
          value: "",
          description: "搜索框",
          reason: "用户要求清空搜索框。",
        }),
      },
      "action_3",
    );

    expect(result.action?.input?.value).toBe("");
  });

  it("creates a low-risk list tabs action", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_tabs_1",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "list_tabs",
          reason: "用户想了解当前窗口有哪些标签页。",
        }),
      },
      "action_tabs_1",
    );

    expect(result.action).toEqual({
      id: "action_tabs_1",
      toolCallId: "tool_tabs_1",
      toolName: "manage_tabs",
      riskLevel: "low",
      requiresConfirmation: false,
      input: {
        operation: "list_tabs",
      },
      reason: "用户想了解当前窗口有哪些标签页。",
    });
  });

  it("creates a low-risk switch tab action for an explicit tab id", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_tabs_2",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "switch_tab",
          tab_id: 42,
          reason: "用户要求切换到指定标签页。",
        }),
      },
      "action_tabs_2",
    );

    expect(result.action).toEqual({
      id: "action_tabs_2",
      toolCallId: "tool_tabs_2",
      toolName: "manage_tabs",
      riskLevel: "low",
      requiresConfirmation: false,
      target: {
        description: "标签页 42",
      },
      input: {
        operation: "switch_tab",
        tabId: 42,
      },
      reason: "用户要求切换到指定标签页。",
    });
  });

  it("creates a confirmable close tab action for explicit tab ids", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_tabs_3",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "close_tab",
          tab_ids: [42, 43],
          reason: "用户要求关闭两个不再需要的标签页。",
        }),
      },
      "action_tabs_3",
    );

    expect(result.action).toEqual({
      id: "action_tabs_3",
      toolCallId: "tool_tabs_3",
      toolName: "manage_tabs",
      riskLevel: "medium",
      requiresConfirmation: true,
      target: {
        description: "2 个标签页",
      },
      input: {
        operation: "close_tab",
        tabIds: [42, 43],
      },
      reason: "用户要求关闭两个不再需要的标签页。",
    });
  });

  it("creates a confirmable tab group action with title, color, and collapse state", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_tabs_4",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "create_group",
          tab_ids: [42, 43],
          title: "资料",
          color: "blue",
          collapsed: true,
          reason: "用户要求把资料标签页收进同一分组。",
        }),
      },
      "action_tabs_4",
    );

    expect(result.action).toEqual({
      id: "action_tabs_4",
      toolCallId: "tool_tabs_4",
      toolName: "manage_tabs",
      riskLevel: "medium",
      requiresConfirmation: true,
      target: {
        description: "2 个标签页",
      },
      input: {
        operation: "create_group",
        tabIds: [42, 43],
        title: "资料",
        color: "blue",
        collapsed: true,
      },
      reason: "用户要求把资料标签页收进同一分组。",
    });
  });

  it("creates confirmable actions for existing tab groups", () => {
    const updateResult = createActionFromToolCall(
      {
        id: "tool_tabs_5",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "update_group",
          group_id: 7,
          title: "工作",
          color: "green",
          collapsed: false,
          reason: "用户要求整理工作分组。",
        }),
      },
      "action_tabs_5",
    );

    expect(updateResult.action).toEqual({
      id: "action_tabs_5",
      toolCallId: "tool_tabs_5",
      toolName: "manage_tabs",
      riskLevel: "medium",
      requiresConfirmation: true,
      target: {
        description: "标签页分组 7",
      },
      input: {
        operation: "update_group",
        groupId: 7,
        title: "工作",
        color: "green",
        collapsed: false,
      },
      reason: "用户要求整理工作分组。",
    });

    const moveResult = createActionFromToolCall(
      {
        id: "tool_tabs_6",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "move_tabs_to_group",
          group_id: 7,
          tab_ids: [42],
          reason: "用户要求把当前资料页加入工作分组。",
        }),
      },
      "action_tabs_6",
    );

    expect(moveResult.action?.input).toEqual({
      operation: "move_tabs_to_group",
      groupId: 7,
      tabIds: [42],
    });

    const ungroupResult = createActionFromToolCall(
      {
        id: "tool_tabs_7",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "ungroup_tabs",
          tab_ids: [42],
          reason: "用户要求把这个标签页移出分组。",
        }),
      },
      "action_tabs_7",
    );

    expect(ungroupResult.action?.input).toEqual({
      operation: "ungroup_tabs",
      tabIds: [42],
    });
  });

  it("blocks tab actions without explicit ids", () => {
    const result = createActionFromToolCall(
      {
        id: "tool_tabs_8",
        index: 0,
        name: "manage_tabs",
        arguments: JSON.stringify({
          operation: "switch_tab",
          reason: "尝试切换但没有明确标签页 id。",
        }),
      },
      "action_tabs_8",
    );

    expect(result.action).toBeUndefined();
    expect(result.blockedReason).toBe(
      "模型请求 manage_tabs，但参数格式未通过校验。",
    );
  });
});
