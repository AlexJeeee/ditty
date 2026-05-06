import type {
  AgentAction,
  ChatMessage,
  ChatSessionSnapshot,
} from "@/shared/types";

const MAX_TITLE_LENGTH = 36;
const MAX_PREVIEW_LENGTH = 80;

const truncate = (value: string, maxLength: number) => {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
};

export const isPersistableChatMessage = (message: ChatMessage) => {
  return message.id !== "welcome";
};

export const sanitizeMessagesForPersistence = (messages: ChatMessage[]) => {
  return messages.filter(isPersistableChatMessage).map((message) => ({
    ...message,
    streaming: false,
  }));
};

export const sanitizeMessagesForHydration = (messages: ChatMessage[]) => {
  return messages.map((message) => {
    const nextMessage: ChatMessage = {
      ...message,
      streaming: false,
    };

    if (
      nextMessage.kind === "action_confirmation" &&
      (nextMessage.actionStatus === "pending" ||
        nextMessage.actionStatus === "executing")
    ) {
      nextMessage.actionStatus = "rejected";
      nextMessage.content = `${nextMessage.content}\n\n该历史动作已过期，请重新发起任务后再执行。`;
    }

    return nextMessage;
  });
};

export const hasExecutableHistoricalAction = (
  action: AgentAction | null,
  messages: ChatMessage[],
) => {
  if (!action) {
    return false;
  }

  return messages.some(
    (message) =>
      message.action?.id === action.id &&
      (message.actionStatus === "pending" ||
        message.actionStatus === "executing"),
  );
};

export const createChatSessionTitle = (
  messages: ChatMessage[],
  fallback = "新对话",
) => {
  const userMessage = messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );

  return truncate(userMessage?.content || fallback, MAX_TITLE_LENGTH);
};

export const createLastMessagePreview = (messages: ChatMessage[]) => {
  const lastMessage = [...messages]
    .reverse()
    .find((message) => message.content.trim());

  return lastMessage ? truncate(lastMessage.content, MAX_PREVIEW_LENGTH) : "";
};

export const sanitizeSnapshotForHydration = (
  snapshot: ChatSessionSnapshot,
): ChatSessionSnapshot => {
  const messages = sanitizeMessagesForHydration(snapshot.messages);

  return {
    ...snapshot,
    messages,
    pendingAction: hasExecutableHistoricalAction(
      snapshot.pendingAction,
      snapshot.messages,
    )
      ? null
      : snapshot.pendingAction,
  };
};
