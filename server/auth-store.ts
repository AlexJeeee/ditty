import type Database from "better-sqlite3";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { createScopedId } from "../src/shared/id";
import type { AuthSessionResponse, AuthUser } from "../src/shared/types";
import { getDatabase } from "./db";

const scrypt = promisify(scryptCallback);
const DEFAULT_QUOTA = 100;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  quota_remaining: number;
  created_at: string;
  updated_at: string;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const toUser = (row: UserRow): AuthUser => ({
  id: row.id,
  email: row.email,
  quotaRemaining: row.quota_remaining,
  createdAt: row.created_at,
});

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const createToken = () => randomBytes(32).toString("base64url");

const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scrypt(
    password,
    salt,
    PASSWORD_KEY_LENGTH,
  )) as Buffer;

  return `scrypt:${salt}:${derivedKey.toString("base64url")}`;
};

const verifyPassword = async (password: string, storedHash: string) => {
  const [algorithm, salt, hash] = storedHash.split(":");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;

  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export class AuthStore {
  private readonly db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  async register(emailValue: string, password: string) {
    const email = this.validateCredentials(emailValue, password);
    const now = new Date().toISOString();
    const userId = createScopedId("user");
    const passwordHash = await hashPassword(password);

    try {
      this.db
        .prepare(
          `
            INSERT INTO users (
              id, email, password_hash, quota_remaining, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(userId, email, passwordHash, DEFAULT_QUOTA, now, now);
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: users\.email/.test(error.message)
      ) {
        throw new Error("邮箱已注册。");
      }

      throw error;
    }

    const user = this.getUserById(userId);

    if (!user) {
      throw new Error("注册失败，请稍后重试。");
    }

    return this.createSession(user);
  }

  async login(emailValue: string, password: string) {
    const email = normalizeEmail(emailValue);
    const row = this.getUserRowByEmail(email);

    if (!row || !(await verifyPassword(password, row.password_hash))) {
      throw new Error("邮箱或密码不正确。");
    }

    return this.createSession(toUser(row));
  }

  getUserByToken(token: string): AuthUser | null {
    if (!token) {
      return null;
    }

    const row = this.db
      .prepare(
        `
          SELECT users.id, users.email, users.password_hash,
            users.quota_remaining, users.created_at, users.updated_at
          FROM user_sessions
          INNER JOIN users ON users.id = user_sessions.user_id
          WHERE user_sessions.token_hash = ?
            AND user_sessions.revoked_at IS NULL
            AND user_sessions.expires_at > ?
        `,
      )
      .get(hashToken(token), new Date().toISOString()) as UserRow | undefined;

    return row ? toUser(row) : null;
  }

  getUserById(userId: string): AuthUser | null {
    const row = this.db
      .prepare(
        `
          SELECT id, email, password_hash, quota_remaining, created_at,
            updated_at
          FROM users
          WHERE id = ?
        `,
      )
      .get(userId) as UserRow | undefined;

    return row ? toUser(row) : null;
  }

  logout(token: string) {
    this.db
      .prepare(
        `
          UPDATE user_sessions
          SET revoked_at = ?
          WHERE token_hash = ? AND revoked_at IS NULL
        `,
      )
      .run(new Date().toISOString(), hashToken(token));
  }

  deductQuota(userId: string): AuthUser {
    const transaction = this.db.transaction(() => {
      const user = this.getUserById(userId);

      if (!user) {
        throw new Error("用户不存在。");
      }

      if (user.quotaRemaining <= 0) {
        throw new Error("额度不足。");
      }

      this.db
        .prepare(
          `
            UPDATE users
            SET quota_remaining = quota_remaining - 1,
              updated_at = ?
            WHERE id = ?
          `,
        )
        .run(new Date().toISOString(), userId);

      return this.getUserById(userId);
    });

    const updatedUser = transaction();

    if (!updatedUser) {
      throw new Error("用户不存在。");
    }

    return updatedUser;
  }

  setQuota(userId: string, quotaRemaining: number) {
    this.db
      .prepare(
        `
          UPDATE users
          SET quota_remaining = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(quotaRemaining, new Date().toISOString(), userId);
  }

  private validateCredentials(emailValue: string, password: string) {
    const email = normalizeEmail(emailValue);

    if (!EMAIL_PATTERN.test(email)) {
      throw new Error("请输入有效邮箱。");
    }

    if (password.length < 8) {
      throw new Error("密码至少需要 8 位。");
    }

    return email;
  }

  private getUserRowByEmail(email: string) {
    return this.db
      .prepare(
        `
          SELECT id, email, password_hash, quota_remaining, created_at,
            updated_at
          FROM users
          WHERE email = ?
        `,
      )
      .get(email) as UserRow | undefined;
  }

  private createSession(user: AuthUser): AuthSessionResponse {
    const accessToken = createToken();
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

    this.db
      .prepare(
        `
          INSERT INTO user_sessions (
            id, user_id, token_hash, created_at, expires_at, revoked_at
          )
          VALUES (?, ?, ?, ?, ?, NULL)
        `,
      )
      .run(
        createScopedId("session"),
        user.id,
        hashToken(accessToken),
        createdAt,
        expiresAt,
      );

    return {
      accessToken,
      user,
    };
  }
}

let authStore: AuthStore | null = null;

export const getAuthStore = () => {
  authStore ??= new AuthStore();
  return authStore;
};
