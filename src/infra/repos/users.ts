import { type Instant, instant } from "@/domain/time";
import { type Db, queryAll, queryOne, queryRow } from "../db";

export type KycStatus = "approved" | "pending" | "rejected";

export interface User {
  id: string;
  email: string;
  country: string;
  createdAt: Instant;
  kycStatus: KycStatus;
}

interface Row {
  id: string;
  email: string;
  country: string;
  created_at: number;
  kyc_status: KycStatus;
}

const toUser = (r: Row): User => ({
  id: r.id,
  email: r.email,
  country: r.country,
  createdAt: instant(r.created_at),
  kycStatus: r.kyc_status,
});

export function upsertUsers(db: Db, users: User[]): void {
  const stmt = db.prepare(`
    INSERT INTO users (id, email, country, created_at, kyc_status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      email = excluded.email, country = excluded.country,
      created_at = excluded.created_at, kyc_status = excluded.kyc_status
  `);
  for (const u of users) stmt.run(u.id, u.email, u.country, u.createdAt, u.kycStatus);
}

export function getUser(db: Db, id: string): User | null {
  const row = queryOne<Row>(db, "SELECT * FROM users WHERE id = ?", id);
  return row ? toUser(row) : null;
}

export function listUsers(db: Db): User[] {
  return (queryAll<Row>(db, "SELECT * FROM users ORDER BY created_at, id")).map(toUser);
}

/** Users who signed up before `before` — the pre-experiment (baseline) cohort. */
export function listUsersCreatedBefore(db: Db, before: Instant): User[] {
  return (
    queryAll<Row>(db, "SELECT * FROM users WHERE created_at < ? ORDER BY created_at, id", before)
  ).map(toUser);
}

export function countUsers(db: Db): number {
  return queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users").n;
}
