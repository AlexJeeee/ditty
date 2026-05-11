import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getDatabasePath } from "./config";

let database: Database.Database | null = null;

const ensureParentDirectory = (databasePath: string) => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
};

export const initializeDatabase = (db: Database.Database) => {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      quota_remaining INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      goal TEXT NOT NULL,
      page_url TEXT NOT NULL DEFAULT '',
      page_title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      stored_run_json TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      page_url TEXT NOT NULL DEFAULT '',
      page_title TEXT NOT NULL DEFAULT '',
      last_message_preview TEXT NOT NULL DEFAULT '',
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message_order INTEGER NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      message_json TEXT NOT NULL,
      PRIMARY KEY (session_id, message_id),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_conversation_messages (
      session_id TEXT NOT NULL,
      message_order INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      tool_call_id TEXT,
      message_json TEXT NOT NULL,
      PRIMARY KEY (session_id, message_order),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);

  const chatSessionColumns = db
    .prepare("PRAGMA table_info(chat_sessions)")
    .all() as { name: string }[];

  if (!chatSessionColumns.some((column) => column.name === "user_id")) {
    db.prepare("ALTER TABLE chat_sessions ADD COLUMN user_id TEXT").run();
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
      ON chat_sessions(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated_at
      ON chat_sessions(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash
      ON user_sessions(token_hash);

    CREATE INDEX IF NOT EXISTS idx_agent_runs_user_updated_at
      ON agent_runs(user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_order
      ON chat_messages(session_id, message_order);

    CREATE INDEX IF NOT EXISTS idx_chat_conversation_session_order
      ON chat_conversation_messages(session_id, message_order);
  `);
};

export const createDatabase = (databasePath = getDatabasePath()) => {
  ensureParentDirectory(databasePath);
  const db = new Database(databasePath);
  initializeDatabase(db);
  return db;
};

export const getDatabase = () => {
  database ??= createDatabase();
  return database;
};
