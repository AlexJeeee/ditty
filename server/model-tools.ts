import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { normalizeHttpUrl } from "../src/shared/url-action";
import type {
  AgentAction,
  AgentToolName,
  TabGroupColor,
  TabManagementOperation,
} from "../src/shared/types";

export interface ToolCallAccumulator {
  id: string;
  index: number;
  name: string;
  arguments: string;
}

export interface ToolActionResult {
  action?: AgentAction;
  blockedReason?: string;
}

interface PendingToolActionResult {
  action?: Omit<AgentAction, "id">;
  blockedReason?: string;
}

interface ModelToolDefinition {
  toolName: AgentToolName;
  chatTool: ChatCompletionTool;
  planStep?: Omit<AgentAction, "id">;
  createActionFromArguments: (value: unknown) => PendingToolActionResult;
}

interface OpenUrlToolArguments {
  url: string;
  reason?: string;
  label?: string;
}

interface ClickElementToolArguments {
  element_id: string;
  description?: string;
  reason?: string;
}

interface FillInputToolArguments {
  element_id: string;
  value: string;
  description?: string;
  reason?: string;
}

interface ManageTabsToolArguments {
  operation: TabManagementOperation;
  tab_id?: number;
  tab_ids?: number[];
  group_id?: number;
  title?: string;
  color?: TabGroupColor;
  collapsed?: boolean;
  reason?: string;
}

const TAB_MANAGEMENT_OPERATIONS = new Set<TabManagementOperation>([
  "list_tabs",
  "switch_tab",
  "reload_tab",
  "close_tab",
  "create_group",
  "update_group",
  "move_tabs_to_group",
  "ungroup_tabs",
]);

const TAB_GROUP_COLORS = new Set<TabGroupColor>([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const isTabId = (value: unknown): value is number => {
  return Number.isInteger(value) && Number(value) > 0;
};

const isGroupId = (value: unknown): value is number => {
  return Number.isInteger(value) && Number(value) >= 0;
};

const parseTabIds = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const uniqueTabIds = [...new Set(value)];

  return uniqueTabIds.length > 0 && uniqueTabIds.every(isTabId)
    ? uniqueTabIds
    : undefined;
};

const parseOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parseOptionalColor = (value: unknown): TabGroupColor | undefined => {
  return typeof value === "string" &&
    TAB_GROUP_COLORS.has(value as TabGroupColor)
    ? (value as TabGroupColor)
    : undefined;
};

const parseOpenUrlArguments = (value: unknown): OpenUrlToolArguments | null => {
  if (!isRecord(value) || typeof value.url !== "string") {
    return null;
  }

  return {
    url: value.url,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    label: typeof value.label === "string" ? value.label : undefined,
  };
};

const createOpenUrlAction = (
  args: OpenUrlToolArguments,
): PendingToolActionResult => {
  const normalized = normalizeHttpUrl(args.url);

  if (!normalized.ok) {
    return {
      blockedReason: `模型请求打开的 URL 未通过校验：${normalized.message}`,
    };
  }

  const reason = args.reason?.trim() || `打开新标签页：${normalized.url}`;
  const label = args.label?.trim() || normalized.url;

  return {
    action: {
      toolName: "open_url",
      riskLevel: "medium",
      requiresConfirmation: true,
      target: {
        description: label,
      },
      input: {
        url: normalized.url,
      },
      reason,
    },
  };
};

const createOpenUrlActionFromArguments = (
  value: unknown,
): PendingToolActionResult => {
  const args = parseOpenUrlArguments(value);

  if (!args) {
    return {
      blockedReason: "模型请求 open_url，但参数格式未通过校验。",
    };
  }

  return createOpenUrlAction(args);
};

const parseClickElementArguments = (
  value: unknown,
): ClickElementToolArguments | null => {
  if (!isRecord(value) || typeof value.element_id !== "string") {
    return null;
  }

  const elementId = value.element_id.trim();
  if (!elementId) {
    return null;
  }

  return {
    element_id: elementId,
    description:
      typeof value.description === "string" ? value.description : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
};

const createClickElementActionFromArguments = (
  value: unknown,
): PendingToolActionResult => {
  const args = parseClickElementArguments(value);

  if (!args) {
    return {
      blockedReason: "模型请求 click_element，但参数格式未通过校验。",
    };
  }

  const description = args.description?.trim() || args.element_id;
  const reason = args.reason?.trim() || `点击页面元素：${description}`;

  return {
    action: {
      toolName: "click_element",
      riskLevel: "medium",
      requiresConfirmation: false,
      target: {
        elementId: args.element_id,
        description,
      },
      reason,
    },
  };
};

const parseFillInputArguments = (
  value: unknown,
): FillInputToolArguments | null => {
  if (
    !isRecord(value) ||
    typeof value.element_id !== "string" ||
    typeof value.value !== "string"
  ) {
    return null;
  }

  const elementId = value.element_id.trim();
  if (!elementId) {
    return null;
  }

  return {
    element_id: elementId,
    value: value.value,
    description:
      typeof value.description === "string" ? value.description : undefined,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
};

const createFillInputActionFromArguments = (
  value: unknown,
): PendingToolActionResult => {
  const args = parseFillInputArguments(value);

  if (!args) {
    return {
      blockedReason: "模型请求 fill_input，但参数格式未通过校验。",
    };
  }

  const description = args.description?.trim() || args.element_id;
  const reason = args.reason?.trim() || `填写输入框：${description}`;

  return {
    action: {
      toolName: "fill_input",
      riskLevel: "medium",
      requiresConfirmation: false,
      target: {
        elementId: args.element_id,
        description,
      },
      input: {
        value: args.value,
      },
      reason,
    },
  };
};

const parseManageTabsArguments = (
  value: unknown,
): ManageTabsToolArguments | null => {
  if (!isRecord(value) || typeof value.operation !== "string") {
    return null;
  }

  const operation = value.operation as TabManagementOperation;
  if (!TAB_MANAGEMENT_OPERATIONS.has(operation)) {
    return null;
  }

  const args: ManageTabsToolArguments = {
    operation,
    reason: parseOptionalString(value.reason),
  };

  if (isTabId(value.tab_id)) {
    args.tab_id = value.tab_id;
  }

  const tabIds = parseTabIds(value.tab_ids);
  if (tabIds) {
    args.tab_ids = tabIds;
  }

  if (isGroupId(value.group_id)) {
    args.group_id = value.group_id;
  }

  const title = parseOptionalString(value.title);
  if (title) {
    args.title = title;
  }

  const color = parseOptionalColor(value.color);
  if (color) {
    args.color = color;
  }

  if (typeof value.collapsed === "boolean") {
    args.collapsed = value.collapsed;
  }

  return args;
};

const createTabTarget = (tabId: number) => ({
  description: `标签页 ${tabId}`,
});

const createTabsTarget = (tabIds: number[]) => ({
  description: `${tabIds.length} 个标签页`,
});

const createGroupTarget = (groupId: number) => ({
  description: `标签页分组 ${groupId}`,
});

const createManageTabsActionFromArguments = (
  value: unknown,
): PendingToolActionResult => {
  const args = parseManageTabsArguments(value);

  if (!args) {
    return {
      blockedReason: "模型请求 manage_tabs，但参数格式未通过校验。",
    };
  }

  const reason = args.reason || "用户请求调整浏览器标签页。";

  if (args.operation === "list_tabs") {
    return {
      action: {
        toolName: "manage_tabs",
        riskLevel: "low",
        requiresConfirmation: false,
        input: {
          operation: "list_tabs",
        },
        reason,
      },
    };
  }

  if (args.operation === "switch_tab" || args.operation === "reload_tab") {
    if (typeof args.tab_id !== "number") {
      return {
        blockedReason: "模型请求 manage_tabs，但参数格式未通过校验。",
      };
    }

    return {
      action: {
        toolName: "manage_tabs",
        riskLevel: args.operation === "switch_tab" ? "low" : "medium",
        requiresConfirmation: args.operation !== "switch_tab",
        target: createTabTarget(args.tab_id),
        input: {
          operation: args.operation,
          tabId: args.tab_id,
        },
        reason,
      },
    };
  }

  if (
    args.operation === "close_tab" ||
    args.operation === "create_group" ||
    args.operation === "ungroup_tabs"
  ) {
    if (!args.tab_ids) {
      return {
        blockedReason: "模型请求 manage_tabs，但参数格式未通过校验。",
      };
    }

    return {
      action: {
        toolName: "manage_tabs",
        riskLevel: "medium",
        requiresConfirmation: true,
        target: createTabsTarget(args.tab_ids),
        input: {
          operation: args.operation,
          tabIds: args.tab_ids,
          ...(args.operation === "create_group" && args.title
            ? { title: args.title }
            : {}),
          ...(args.operation === "create_group" && args.color
            ? { color: args.color }
            : {}),
          ...(args.operation === "create_group" &&
          typeof args.collapsed === "boolean"
            ? { collapsed: args.collapsed }
            : {}),
        },
        reason,
      },
    };
  }

  if (args.operation === "update_group") {
    const hasUpdate =
      Boolean(args.title || args.color) || typeof args.collapsed === "boolean";

    if (typeof args.group_id !== "number" || !hasUpdate) {
      return {
        blockedReason: "模型请求 manage_tabs，但参数格式未通过校验。",
      };
    }

    return {
      action: {
        toolName: "manage_tabs",
        riskLevel: "medium",
        requiresConfirmation: true,
        target: createGroupTarget(args.group_id),
        input: {
          operation: "update_group",
          groupId: args.group_id,
          ...(args.title ? { title: args.title } : {}),
          ...(args.color ? { color: args.color } : {}),
          ...(typeof args.collapsed === "boolean"
            ? { collapsed: args.collapsed }
            : {}),
        },
        reason,
      },
    };
  }

  if (args.operation === "move_tabs_to_group") {
    if (typeof args.group_id !== "number" || !args.tab_ids) {
      return {
        blockedReason: "模型请求 manage_tabs，但参数格式未通过校验。",
      };
    }

    return {
      action: {
        toolName: "manage_tabs",
        riskLevel: "medium",
        requiresConfirmation: true,
        target: createGroupTarget(args.group_id),
        input: {
          operation: "move_tabs_to_group",
          groupId: args.group_id,
          tabIds: args.tab_ids,
        },
        reason,
      },
    };
  }

  return {
    blockedReason: "模型请求 manage_tabs，但参数格式未通过校验。",
  };
};

const MODEL_TOOL_DEFINITIONS: ModelToolDefinition[] = [
  {
    toolName: "open_url",
    chatTool: {
      type: "function",
      function: {
        name: "open_url",
        description:
          "请求 Chrome 扩展在用户确认后打开一个新的 http/https 标签页。仅当用户明确要求打开网页，或当前任务确实需要跳转到一个确定网址时使用。",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: {
              type: "string",
              description:
                "要打开的 http/https URL。可以是带协议的网址，也可以是明确的域名。",
            },
            reason: {
              type: "string",
              description: "向用户说明为什么需要打开这个网页。",
            },
            label: {
              type: "string",
              description: "目标网页的简短名称，例如站点名或页面名。",
            },
          },
          required: ["url", "reason"],
        },
      },
    },
    planStep: {
      toolName: "open_url",
      riskLevel: "medium",
      requiresConfirmation: true,
      reason:
        "如果任务需要打开一个确定的 http/https 页面，模型会生成 open_url 动作，执行前仍需用户确认。",
    },
    createActionFromArguments: createOpenUrlActionFromArguments,
  },
  {
    toolName: "click_element",
    chatTool: {
      type: "function",
      function: {
        name: "click_element",
        description:
          "请求 Chrome 扩展在用户确认后点击当前页面上下文里采集到的可交互 DOM 元素。只能使用可交互元素摘要中明确给出的 element_id，不要猜测或编造。",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            element_id: {
              type: "string",
              description: "页面上下文可交互元素摘要中的 id，例如 el_1_ab123。",
            },
            description: {
              type: "string",
              description: "目标元素的人类可读描述，例如按钮文案。",
            },
            reason: {
              type: "string",
              description: "向用户说明为什么需要点击这个元素。",
            },
          },
          required: ["element_id", "description", "reason"],
        },
      },
    },
    planStep: {
      toolName: "click_element",
      riskLevel: "medium",
      requiresConfirmation: false,
      reason:
        "如果任务需要点击当前网页中的明确 DOM 元素，模型会生成 click_element 动作，直接执行。",
    },
    createActionFromArguments: createClickElementActionFromArguments,
  },
  {
    toolName: "fill_input",
    chatTool: {
      type: "function",
      function: {
        name: "fill_input",
        description:
          "请求 Chrome 扩展在用户确认后填写当前页面上下文里采集到的输入框、文本域、下拉框或可编辑区域。只能使用可交互元素摘要中明确给出的 element_id，不要填写密码、验证码、token、支付信息等敏感字段。",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            element_id: {
              type: "string",
              description: "页面上下文可交互元素摘要中的 id，例如 el_1_ab123。",
            },
            value: {
              type: "string",
              description: "要填入目标输入框的文本。清空输入框时传空字符串。",
            },
            description: {
              type: "string",
              description: "目标输入框的人类可读描述，例如搜索框占位文本。",
            },
            reason: {
              type: "string",
              description: "向用户说明为什么需要填写这个输入框。",
            },
          },
          required: ["element_id", "value", "description", "reason"],
        },
      },
    },
    planStep: {
      toolName: "fill_input",
      riskLevel: "medium",
      requiresConfirmation: false,
      reason:
        "如果任务需要填写当前网页中的明确输入控件，模型会生成 fill_input 动作，直接执行。",
    },
    createActionFromArguments: createFillInputActionFromArguments,
  },
  {
    toolName: "manage_tabs",
    chatTool: {
      type: "function",
      function: {
        name: "manage_tabs",
        description:
          "请求 Chrome 扩展管理浏览器标签页和标签页分组。必须先通过 list_tabs 或已知动作结果获得明确的 tab_id/group_id，不能猜测 id。关闭、刷新、分组移动等会改变浏览器状态的操作会在执行前请求用户确认。",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            operation: {
              type: "string",
              enum: [
                "list_tabs",
                "switch_tab",
                "reload_tab",
                "close_tab",
                "create_group",
                "update_group",
                "move_tabs_to_group",
                "ungroup_tabs",
              ],
              description: "要执行的标签页或分组操作。",
            },
            tab_id: {
              type: "number",
              description: "单个目标标签页 id，用于 switch_tab 或 reload_tab。",
            },
            tab_ids: {
              type: "array",
              items: { type: "number" },
              description:
                "一个或多个明确标签页 id，用于 close_tab、create_group、move_tabs_to_group 或 ungroup_tabs。",
            },
            group_id: {
              type: "number",
              description:
                "目标标签页分组 id，用于 update_group 或 move_tabs_to_group。",
            },
            title: {
              type: "string",
              description:
                "标签页分组标题，用于 create_group 或 update_group。",
            },
            color: {
              type: "string",
              enum: [
                "grey",
                "blue",
                "red",
                "yellow",
                "green",
                "pink",
                "purple",
                "cyan",
                "orange",
              ],
              description: "标签页分组颜色。",
            },
            collapsed: {
              type: "boolean",
              description: "是否折叠标签页分组。",
            },
            reason: {
              type: "string",
              description: "向用户说明为什么需要执行这个标签页操作。",
            },
          },
          required: ["operation", "reason"],
        },
      },
    },
    planStep: {
      toolName: "manage_tabs",
      riskLevel: "medium",
      requiresConfirmation: true,
      reason:
        "如果任务需要切换、刷新、关闭标签页或调整标签页分组，模型会生成 manage_tabs 动作；改变浏览器状态的操作会在执行前请求用户确认。",
    },
    createActionFromArguments: createManageTabsActionFromArguments,
  },
];

const MODEL_TOOL_DEFINITION_BY_NAME = new Map(
  MODEL_TOOL_DEFINITIONS.map((definition) => [definition.toolName, definition]),
);

export const MODEL_CHAT_TOOLS = MODEL_TOOL_DEFINITIONS.map(
  (definition) => definition.chatTool,
);
export const MODEL_TOOL_PLAN_STEPS = MODEL_TOOL_DEFINITIONS.flatMap(
  (definition) => (definition.planStep ? [definition.planStep] : []),
);

export const hasModelToolDefinition = (toolName: string) => {
  return MODEL_TOOL_DEFINITION_BY_NAME.has(toolName as AgentToolName);
};

export const accumulateToolCalls = (
  toolCalls: ToolCallAccumulator[],
  deltas: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
) => {
  for (const delta of deltas) {
    let toolCall = toolCalls.find((item) => item.index === delta.index);

    if (!toolCall) {
      toolCall = {
        id: delta.id || "",
        index: delta.index,
        name: "",
        arguments: "",
      };
      toolCalls.push(toolCall);
    }

    if (delta.id) {
      toolCall.id = delta.id;
    }

    if (delta.function?.name) {
      toolCall.name += delta.function.name;
    }

    if (delta.function?.arguments) {
      toolCall.arguments += delta.function.arguments;
    }
  }
};

const parseToolArguments = (
  argumentsText: string,
): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const createActionFromToolCall = (
  toolCall: ToolCallAccumulator,
  actionId: string,
): ToolActionResult => {
  const definition = MODEL_TOOL_DEFINITION_BY_NAME.get(
    toolCall.name as AgentToolName,
  );

  if (!definition) {
    return {
      blockedReason: `模型请求了未启用的工具：${toolCall.name || "(unknown)"}。`,
    };
  }

  const rawArgs = parseToolArguments(toolCall.arguments);

  if (!rawArgs) {
    return {
      blockedReason: `模型请求 ${definition.toolName}，但参数不是有效 JSON 对象。`,
    };
  }

  const result = definition.createActionFromArguments(rawArgs);

  return result.action
    ? {
        action: {
          ...result.action,
          id: actionId,
          toolCallId: toolCall.id || actionId,
        },
      }
    : {
        blockedReason: result.blockedReason,
      };
};
