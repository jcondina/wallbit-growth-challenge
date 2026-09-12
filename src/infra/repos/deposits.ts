import type { DepositState, DepositStatus } from "@/domain/deposit";
import { type Instant, instant } from "@/domain/time";
import { type Db, bool, nullable, queryAll, queryOne } from "../db";

export type DepositSource = "webhook" | "historical";

/** The domain state plus its persistence envelope. */
export interface DepositRecord extends DepositState {
  source: DepositSource;
  userKnown: boolean;
  updatedAt: Instant;
}

interface Row {
  id: string;
  user_id: string;
  method_id: string;
  amount_usd: number;
  currency: string | null;
  country: string | null;
  status: DepositStatus;
  initiated_at: number | null;
  completed_at: number | null;
  failed_at: number | null;
  source: DepositSource;
  user_known: 0 | 1;
  updated_at: number;
}

const opt = (v: number | null): Instant | null => (v === null ? null : instant(v));

const toDeposit = (r: Row): DepositRecord => ({
  id: r.id,
  userId: r.user_id,
  methodId: r.method_id,
  amountUsd: r.amount_usd,
  currency: r.currency,
  country: r.country,
  status: r.status,
  initiatedAt: opt(r.initiated_at),
  completedAt: opt(r.completed_at),
  failedAt: opt(r.failed_at),
  source: r.source,
  userKnown: r.user_known === 1,
  updatedAt: instant(r.updated_at),
});

const COLUMNS = `
  (id, user_id, method_id, amount_usd, currency, country, status,
   initiated_at, completed_at, failed_at, source, user_known, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT = `
  INSERT INTO deposits ${COLUMNS}
  ON CONFLICT (id) DO UPDATE SET
    user_id = excluded.user_id, method_id = excluded.method_id,
    amount_usd = excluded.amount_usd, currency = excluded.currency, country = excluded.country,
    status = excluded.status, initiated_at = excluded.initiated_at,
    completed_at = excluded.completed_at, failed_at = excluded.failed_at,
    source = excluded.source, user_known = excluded.user_known, updated_at = excluded.updated_at
`;

const INSERT_IF_MISSING = `INSERT OR IGNORE INTO deposits ${COLUMNS}`;

const params = (d: DepositRecord) => [
  d.id,
  d.userId,
  d.methodId,
  d.amountUsd,
  nullable(d.currency),
  nullable(d.country),
  d.status,
  nullable(d.initiatedAt),
  nullable(d.completedAt),
  nullable(d.failedAt),
  d.source,
  bool(d.userKnown),
  d.updatedAt,
];

export function upsertDeposit(db: Db, d: DepositRecord): void {
  db.prepare(UPSERT).run(...params(d));
}

/** For fixtures: insert only if absent (a reseed never touches existing rows). Returns true when inserted. */
export function insertDepositIfMissing(db: Db, d: DepositRecord): boolean {
  return db.prepare(INSERT_IF_MISSING).run(...params(d)).changes === 1;
}

export function getDeposit(db: Db, id: string): DepositRecord | null {
  const row = queryOne<Row>(db, "SELECT * FROM deposits WHERE id = ?", id);
  return row ? toDeposit(row) : null;
}

export function listDepositsByUser(db: Db, userId: string): DepositRecord[] {
  return (
    queryAll<Row>(db, "SELECT * FROM deposits WHERE user_id = ? ORDER BY id", userId)
  ).map(toDeposit);
}

export function listDeposits(db: Db): DepositRecord[] {
  return (queryAll<Row>(db, "SELECT * FROM deposits ORDER BY id")).map(toDeposit);
}

export function countDepositsByStatus(db: Db, source?: DepositSource): Record<DepositStatus, number> {
  type Count = { status: DepositStatus; n: number };
  const rows = source
    ? queryAll<Count>(db, "SELECT status, COUNT(*) AS n FROM deposits WHERE source = ? GROUP BY status", source)
    : queryAll<Count>(db, "SELECT status, COUNT(*) AS n FROM deposits GROUP BY status");
  const counts: Record<DepositStatus, number> = { received: 0, completed: 0, failed: 0, conflict: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}
