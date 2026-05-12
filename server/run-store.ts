import type Database from "better-sqlite3";
import type {
  AgentRun,
  ModelConversationMessage,
  PageContext,
} from "../src/shared/types";
import { getDefaultModelRoute } from "./config";
import { getDatabase } from "./db";

const MAX_VISIBLE_TEXT_LENGTH = 6000;
const MAX_SELECTED_TEXT_LENGTH = 4000;
const MAX_ELEMENT_COUNT = 100;

export interface StoredRun {
  run: AgentRun;
  userId: string;
  goal: string;
  pageContext: PageContext;
  conversation: ModelConversationMessage[];
  currentUserMessage: ModelConversationMessage & { role: "user" };
  currentUserMessageEmitted: boolean;
  persist?: () => void;
}

export interface ActiveStream {
  abortController: AbortController;
}

export const activeStreams = new Map<string, ActiveStream>();

interface AgentRunRow {
  id: string;
  user_id: string;
  status: AgentRun["status"];
  goal: string;
  page_url: string;
  page_title: string;
  created_at: string;
  updated_at: string;
  stored_run_json: string;
}

export class RunStore {
  private readonly db: Database.Database;
  private readonly cache = new Map<string, StoredRun>();

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  get(runId: string): StoredRun | undefined {
    const cached = this.cache.get(runId);

    if (cached) {
      return cached;
    }

    const row = this.db
      .prepare(
        `
          SELECT id, user_id, status, goal, page_url, page_title,
            created_at, updated_at, stored_run_json
          FROM agent_runs
          WHERE id = ?
        `,
      )
      .get(runId) as AgentRunRow | undefined;

    if (!row) {
      return undefined;
    }

    const stored = JSON.parse(row.stored_run_json) as StoredRun;
    stored.run.modelRoute ??= getDefaultModelRoute();
    stored.persist = () => {
      this.set(stored.run.id, stored);
    };
    this.cache.set(runId, stored);

    return stored;
  }

  set(runId: string, stored: StoredRun) {
    stored.run.modelRoute ??= getDefaultModelRoute();
    stored.persist = () => {
      this.set(stored.run.id, stored);
    };
    this.cache.set(runId, stored);
    this.db
      .prepare(
        `
          INSERT INTO agent_runs (
            id, user_id, status, goal, page_url, page_title,
            created_at, updated_at, stored_run_json
          )
          VALUES (
            @id, @userId, @status, @goal, @pageUrl, @pageTitle,
            @createdAt, @updatedAt, @storedRunJson
          )
          ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            status = excluded.status,
            goal = excluded.goal,
            page_url = excluded.page_url,
            page_title = excluded.page_title,
            updated_at = excluded.updated_at,
            stored_run_json = excluded.stored_run_json
        `,
      )
      .run({
        id: runId,
        userId: stored.userId,
        status: stored.run.status,
        goal: stored.goal,
        pageUrl: stored.run.pageUrl,
        pageTitle: stored.run.pageTitle,
        createdAt: stored.run.createdAt,
        updatedAt: stored.run.updatedAt,
        storedRunJson: JSON.stringify(stored),
      });

    return this;
  }

  delete(runId: string) {
    this.cache.delete(runId);
    const result = this.db
      .prepare("DELETE FROM agent_runs WHERE id = ?")
      .run(runId);

    return result.changes > 0;
  }

  clearMemory() {
    this.cache.clear();
  }
}

export const runs = new RunStore();

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
  stored.persist?.();
};
