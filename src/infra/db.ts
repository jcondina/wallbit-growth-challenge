import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/**
 * SQLite connection (node:sqlite — no native build step for whoever clones).
 *
 * - One connection per process, cached on globalThis so Next.js hot reloads
 *   do not reopen the file.
 * - Schema bootstrap runs on every open; every statement is IF NOT EXISTS.
 * - Callers pass the handle explicitly (repos take `db` as first argument),
 *   which is what lets tests run against ':memory:'.
 */

export type Db = DatabaseSync;

export const DEFAULT_DB_PATH = "var/wallbit.db";

// Resolved from the project root: `next dev|start`, `tsx scripts/*` and
// vitest all run with cwd = repo root. Not from import.meta.url, which the
// bundler may relocate.
const SCHEMA_PATH = path.join(process.cwd(), "src", "infra", "schema.sql");

export function openDb(filePath: string = process.env.DB_PATH ?? DEFAULT_DB_PATH): Db {
  const location = filePath === ":memory:" ? filePath : path.resolve(process.cwd(), filePath);
  if (location !== ":memory:") mkdirSync(path.dirname(location), { recursive: true });

  const db = new DatabaseSync(location);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  migrate(db);
  return db;
}

// Additive, idempotent migrations for files created by an earlier schema.
// (CREATE TABLE IF NOT EXISTS does not add columns to existing tables.)
function migrate(db: Db): void {
  const columns = (db.prepare("PRAGMA table_info(webhook_inbox)").all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes("deliveries")) {
    db.exec("ALTER TABLE webhook_inbox ADD COLUMN deliveries INTEGER NOT NULL DEFAULT 1");
  }
}

declare global {
  var __wallbitDb: Db | undefined;
}

/** The process-wide connection used by the app (routes, pages, services). */
export function getDb(): Db {
  if (!globalThis.__wallbitDb) globalThis.__wallbitDb = openDb();
  return globalThis.__wallbitDb;
}

/**
 * Runs `fn` inside BEGIN IMMEDIATE … COMMIT, rolling back on throw.
 * IMMEDIATE takes the write lock up front, so two concurrent deliveries of
 * the same webhook serialize instead of racing on a read-then-write.
 */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** SQLite has no booleans; bind 0/1 explicitly (node:sqlite refuses `true`/`false`). */
export function bool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/** node:sqlite refuses `undefined`; normalize optional values to NULL. */
export function nullable<T>(value: T | null | undefined): T | null {
  return value === undefined ? null : value;
}

// Compiling SQL is the dominant cost of a small query. Statements are cached
// per connection and per SQL text (the WeakMap lets a closed connection be
// garbage-collected), so repositories can keep passing plain strings.
const statementCache = new WeakMap<Db, Map<string, StatementSync>>();

export function statement(db: Db, sql: string): StatementSync {
  let cache = statementCache.get(db);
  if (!cache) {
    cache = new Map();
    statementCache.set(db, cache);
  }
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

// node:sqlite types every row as Record<string, SQLOutputValue>. Repositories
// declare the shape they expect; these helpers are the single place where
// that declaration is trusted.
export function queryAll<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
  return statement(db, sql).all(...params) as unknown as T[];
}

export function queryOne<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
  return statement(db, sql).get(...params) as unknown as T | undefined;
}

/** For INSERT / UPDATE / DELETE; returns the number of affected rows. */
export function run(db: Db, sql: string, ...params: SQLInputValue[]): number {
  return Number(statement(db, sql).run(...params).changes);
}

/** For aggregates (COUNT, SUM, MAX…) which always produce exactly one row. */
export function queryRow<T>(db: Db, sql: string, ...params: SQLInputValue[]): T {
  const row = queryOne<T>(db, sql, ...params);
  if (row === undefined) throw new Error(`query returned no row: ${sql.trim().slice(0, 60)}`);
  return row;
}
