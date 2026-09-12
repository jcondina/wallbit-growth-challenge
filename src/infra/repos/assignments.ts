import type { Variant } from "@/domain/experiment";
import { type Instant, instant } from "@/domain/time";
import { type Db, queryAll, queryOne } from "../db";

export interface Assignment {
  experimentId: string;
  userId: string;
  variant: Variant;
  allocationVersion: number;
  assignedAt: Instant;
}

interface Row {
  experiment_id: string;
  user_id: string;
  variant: string;
  allocation_version: number;
  assigned_at: number;
}

const toAssignment = (r: Row): Assignment => ({
  experimentId: r.experiment_id,
  userId: r.user_id,
  variant: r.variant,
  allocationVersion: r.allocation_version,
  assignedAt: instant(r.assigned_at),
});

/** Returns true when the row was created, false when the user was already assigned. */
export function insertAssignmentIfMissing(db: Db, a: Assignment): boolean {
  const result = db
    .prepare(`
      INSERT OR IGNORE INTO assignments (experiment_id, user_id, variant, allocation_version, assigned_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(a.experimentId, a.userId, a.variant, a.allocationVersion, a.assignedAt);
  return result.changes === 1;
}

export function getAssignment(db: Db, experimentId: string, userId: string): Assignment | null {
  const row = queryOne<Row>(db, "SELECT * FROM assignments WHERE experiment_id = ? AND user_id = ?", experimentId, userId);
  return row ? toAssignment(row) : null;
}

export function listAssignments(db: Db, experimentId: string): Assignment[] {
  return (
    queryAll<Row>(db, "SELECT * FROM assignments WHERE experiment_id = ? ORDER BY assigned_at, user_id", experimentId)
  ).map(toAssignment);
}

export function countAssignmentsByVariant(db: Db, experimentId: string): Record<Variant, number> {
  const rows = queryAll<{ variant: string; n: number }>(db, "SELECT variant, COUNT(*) AS n FROM assignments WHERE experiment_id = ? GROUP BY variant", experimentId);
  return Object.fromEntries(rows.map((r) => [r.variant, r.n]));
}
