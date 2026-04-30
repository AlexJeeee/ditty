import { describe, expect, it } from "vitest";
import { createActionFromToolCall } from "./model-tools";

describe("createActionFromToolCall", () => {
  it("creates a confirmable click action for a collected DOM element", () => {
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
      requiresConfirmation: true,
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

  it("creates a confirmable fill action for a collected input", () => {
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
      requiresConfirmation: true,
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
});
