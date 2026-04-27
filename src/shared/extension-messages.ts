import type { AgentAction, AgentActionResult, AgentRunEvent, ExtensionError, PageContext } from "./types";

export interface GetPageContextMessage {
  type: "page_context:get";
  payload: {
    includeSelection: boolean;
    includeInteractiveElements: boolean;
  };
}

export interface ExecuteActionMessage {
  type: "agent_action:execute";
  payload: {
    runId: string;
    action: AgentAction;
  };
}

export interface HighlightElementMessage {
  type: "element:highlight";
  payload: {
    elementId: string;
    durationMs: number;
  };
}

export interface AgentRunUpdateMessage {
  type: "agent_run:update";
  payload: AgentRunEvent;
}

export interface AuthStateChangedMessage {
  type: "auth:state_changed";
  payload: {
    authenticated: boolean;
  };
}

export type ExtensionMessage =
  | GetPageContextMessage
  | ExecuteActionMessage
  | HighlightElementMessage
  | AgentRunUpdateMessage
  | AuthStateChangedMessage;

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
