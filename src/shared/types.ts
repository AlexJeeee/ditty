export type ActionRiskLevel = "low" | "medium" | "high";

export type AgentRunStatus =
  | "idle"
  | "created"
  | "planning"
  | "requires_confirmation"
  | "running"
  | "stopped"
  | "completed"
  | "blocked"
  | "failed";

export type AgentActionStatus =
  | "pending_confirmation"
  | "confirmed"
  | "skipped"
  | "running"
  | "succeeded"
  | "blocked"
  | "failed";

export type AgentToolName =
  | "read_page"
  | "summarize_selection"
  | "extract_table"
  | "highlight_element"
  | "click_element"
  | "fill_input"
  | "scroll_page"
  | "open_url"
  | "copy_result";

export interface PageHeading {
  level: number;
  text: string;
}

export interface PageTableSummary {
  id: string;
  rowCount: number;
  columnCount: number;
  caption?: string;
  preview: string[][];
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InteractiveElement {
  id: string;
  tagName: string;
  role: string;
  label: string;
  valuePreview?: string;
  inputType?: string;
  placeholder?: string;
  rect: ElementRect;
  riskLevel: ActionRiskLevel;
  disabled: boolean;
}

export interface PageContext {
  url: string;
  origin: string;
  title: string;
  selectedText: string;
  visibleTextSummary: string;
  headings: PageHeading[];
  tables: PageTableSummary[];
  interactiveElements: InteractiveElement[];
  collectedAt: string;
}

export interface AgentAction {
  id: string;
  toolName: AgentToolName;
  riskLevel: ActionRiskLevel;
  requiresConfirmation: boolean;
  target?: {
    elementId?: string;
    description: string;
  };
  input?: {
    text?: string;
    value?: string;
    url?: string;
  };
  reason: string;
}

export interface AgentPlan {
  summary: string;
  steps: AgentAction[];
  blockedActions: AgentAction[];
}

export interface AgentRun {
  id: string;
  status: AgentRunStatus;
  goal: string;
  pageUrl: string;
  pageTitle: string;
  plan?: AgentPlan;
  createdAt: string;
  updatedAt: string;
}

export interface AgentActionResult {
  actionId: string;
  status: AgentActionStatus;
  message: string;
  output?: unknown;
  error?: ExtensionError;
}

export type AgentRunEvent =
  | { type: "status"; runId: string; status: AgentRunStatus }
  | { type: "message"; runId: string; text: string }
  | { type: "message_delta"; runId: string; messageId: string; text: string; done?: boolean; channel?: "thinking" | "answer" }
  | { type: "plan"; runId: string; plan: AgentPlan }
  | { type: "action_request"; runId: string; action: AgentAction }
  | { type: "action_result"; runId: string; result: AgentActionResult }
  | { type: "error"; runId: string; error: ExtensionError };

export interface ExtensionError {
  code:
    | "NOT_AUTHENTICATED"
    | "TAB_NOT_ACCESSIBLE"
    | "CONTENT_SCRIPT_UNAVAILABLE"
    | "PAGE_CONTEXT_BLOCKED"
    | "ACTION_REJECTED"
    | "ACTION_TARGET_MISSING"
    | "ACTION_RISK_BLOCKED"
    | "NETWORK_ERROR"
    | "UNKNOWN_ERROR";
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
