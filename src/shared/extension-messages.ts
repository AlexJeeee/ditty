import type { AgentAction, AgentActionResult, ExtensionError, PageContext } from "./types";

export const PENDING_SELECTION_ACTION_STORAGE_KEY = "pendingSelectionAction";

export type SelectionMenuAction = "translate" | "explain" | "add_to_chat";

export interface SelectionActionPayload {
  id: string;
  action: SelectionMenuAction;
  selectedText: string;
  pageTitle: string;
  pageUrl: string;
  requestedAt: string;
}

export interface GetPageContextMessage {
  type: "page_context:get";
  payload: {
    includeSelection: boolean;
    includeInteractiveElements: boolean;
    tabId?: number;
  };
}

export interface ExecuteActionMessage {
  type: "agent_action:execute";
  payload: {
    runId: string;
    action: AgentAction;
  };
}

export interface SelectionActionInvokeMessage {
  type: "selection_action:invoke";
  payload: SelectionActionPayload;
}

export interface ActiveTabChangedMessage {
  type: "active_tab:changed";
  payload: {
    tabId: number;
    windowId: number;
    url?: string;
    title?: string;
    status?: "loading" | "complete" | "unloaded";
  };
}

export type ExtensionMessage =
  | GetPageContextMessage
  | ExecuteActionMessage
  | SelectionActionInvokeMessage
  | ActiveTabChangedMessage;

export type ExtensionResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: ExtensionError;
    };

export type PageContextResponse = ExtensionResponse<PageContext>;
export type ActionExecutionResponse = ExtensionResponse<AgentActionResult>;
export type SelectionActionResponse = ExtensionResponse<SelectionActionPayload>;
