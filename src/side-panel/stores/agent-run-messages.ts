import { createScopedId } from "@/shared/id";
import type {
  AgentAction,
  AgentActionResult,
  AgentPlan,
  AgentRun,
  AgentRunEvent,
} from "@/shared/types";

export type ChatRole = "user" | "assistant" | "system";
export type ChatMessageKind =
  | "text"
  | "thinking"
  | "plan"
  | "action_confirmation"
  | "result"
  | "error";
export type ActionMessageStatus =
  | "pending"
  | "executing"
  | "confirmed"
  | "rejected";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  kind: ChatMessageKind;
  content: string;
  createdAt: string;
  streaming?: boolean;
  plan?: AgentPlan;
  action?: AgentAction;
  actionStatus?: ActionMessageStatus;
  result?: AgentActionResult;
}

export interface AgentRunMessageState {
  run: AgentRun | null;
  plan: AgentPlan | null;
  events: AgentRunEvent[];
  pendingAction: AgentAction | null;
  results: AgentActionResult[];
  messages: ChatMessage[];
}

export interface AppliedAgentRunEvent {
  autoAction?: AgentAction;
  error?: AgentRunEvent & { type: "error" };
}

export const createMessageId = (prefix: string) => createScopedId(prefix, 6);

export const createWelcomeMessage = (): ChatMessage => {
  return {
    id: "welcome",
    role: "assistant",
    kind: "text",
    content:
      "你好，我可以读取当前网页、解释选中文本，并在需要操作页面时先把动作发到这里让你确认。",
    createdAt: new Date().toISOString(),
  };
};

export const createChatMessage = (
  message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string },
): ChatMessage => {
  return {
    ...message,
    id: message.id ?? createMessageId(message.kind),
    createdAt: new Date().toISOString(),
  };
};

export const formatPlan = (planValue: AgentPlan) => {
  const steps = planValue.steps
    .map((step, index) => `${index + 1}. ${step.toolName}：${step.reason}`)
    .join("\n");
  const blocked = planValue.blockedActions.length
    ? `\n\n已阻断的高风险动作：\n${planValue.blockedActions
        .map(
          (action) =>
            `- ${action.target?.description ?? action.toolName}：${action.reason}`,
        )
        .join("\n")}`
    : "";

  return `${planValue.summary}\n\n计划：\n${steps}${blocked}`;
};

export const pushMessage = (
  state: Pick<AgentRunMessageState, "messages">,
  message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string },
) => {
  const chatMessage = createChatMessage(message);
  state.messages.push(chatMessage);
  return chatMessage;
};

export const appendTextDelta = (
  state: Pick<AgentRunMessageState, "messages">,
  messageId: string,
  text: string,
  done = false,
  kind: ChatMessageKind = "thinking",
) => {
  let message = state.messages.find((item) => item.id === messageId);

  if (!message) {
    message = pushMessage(state, {
      id: messageId,
      role: "assistant",
      kind,
      content: "",
      streaming: true,
    });
  }

  message.content += text;
  message.streaming = !done;
};

export const finishStreamingMessages = (
  state: Pick<AgentRunMessageState, "messages">,
) => {
  for (const message of state.messages) {
    if (message.streaming) {
      message.streaming = false;
    }
  }
};

export const updateActionMessage = (
  state: Pick<AgentRunMessageState, "messages">,
  actionId: string,
  status: ActionMessageStatus,
  content?: string,
) => {
  const message = state.messages.find((item) => item.action?.id === actionId);

  if (!message) {
    return;
  }

  message.actionStatus = status;
  if (content) {
    message.content = content;
  }
};

export const applyAgentRunEvent = (
  state: AgentRunMessageState,
  event: AgentRunEvent,
): AppliedAgentRunEvent => {
  state.events.push(event);

  if (event.type === "status" && state.run) {
    state.run.status = event.status;
    state.run.updatedAt = new Date().toISOString();
  }

  if (event.type === "message") {
    pushMessage(state, {
      role: "assistant",
      kind: "text",
      content: event.text,
    });
  }

  if (event.type === "message_delta") {
    appendTextDelta(
      state,
      event.messageId,
      event.text,
      event.done,
      event.channel === "answer" ? "text" : "thinking",
    );
  }

  if (event.type === "plan") {
    state.plan = event.plan;
    if (state.run) {
      state.run.plan = event.plan;
    }
    pushMessage(state, {
      role: "assistant",
      kind: "plan",
      content: formatPlan(event.plan),
      plan: event.plan,
    });
  }

  if (event.type === "action_request") {
    pushMessage(state, {
      id: `action_${event.action.id}`,
      role: "assistant",
      kind: "action_confirmation",
      content: event.action.reason,
      action: event.action,
      actionStatus: event.action.requiresConfirmation ? "pending" : "executing",
    });

    if (event.action.requiresConfirmation) {
      state.pendingAction = event.action;
    } else {
      return { autoAction: event.action };
    }
  }

  if (event.type === "action_result") {
    state.results.push(event.result);
    pushMessage(state, {
      role: "assistant",
      kind: "result",
      content: `${event.result.status}：${event.result.message}`,
      result: event.result,
    });
  }

  if (event.type === "error") {
    pushMessage(state, {
      role: "assistant",
      kind: "error",
      content: event.error.message,
    });
    return { error: event };
  }

  return {};
};
