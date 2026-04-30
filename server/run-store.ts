import type {
  AgentRun,
  ModelConversationMessage,
  PageContext,
} from "../src/shared/types";

const MAX_VISIBLE_TEXT_LENGTH = 6000;
const MAX_SELECTED_TEXT_LENGTH = 4000;
const MAX_ELEMENT_COUNT = 20;

export interface StoredRun {
  run: AgentRun;
  goal: string;
  pageContext: PageContext;
  conversation: ModelConversationMessage[];
  currentUserMessage: ModelConversationMessage & { role: "user" };
  currentUserMessageEmitted: boolean;
}

export interface ActiveStream {
  abortController: AbortController;
}

export const runs = new Map<string, StoredRun>();
export const activeStreams = new Map<string, ActiveStream>();

const truncate = (value: string | undefined, maxLength: number) => {
  if (!value) {
    return "";
  }

  return value.length > maxLength
    ? `${value.slice(0, maxLength)}\n...[truncated]`
    : value;
};

export const validatePageContext = (value: unknown): PageContext => {
  if (!value || typeof value !== "object") {
    throw new Error("pageContext 缺失。");
  }

  const pageContext = value as PageContext;

  if (
    typeof pageContext.url !== "string" ||
    typeof pageContext.title !== "string"
  ) {
    throw new Error("pageContext 格式不正确。");
  }

  return {
    ...pageContext,
    selectedText: truncate(pageContext.selectedText, MAX_SELECTED_TEXT_LENGTH),
    visibleTextSummary: truncate(
      pageContext.visibleTextSummary,
      MAX_VISIBLE_TEXT_LENGTH,
    ),
    interactiveElements: (pageContext.interactiveElements ?? []).slice(
      0,
      MAX_ELEMENT_COUNT,
    ),
  };
};

export const setRunStatus = (stored: StoredRun, status: AgentRun["status"]) => {
  stored.run.status = status;
  stored.run.updatedAt = new Date().toISOString();
};
