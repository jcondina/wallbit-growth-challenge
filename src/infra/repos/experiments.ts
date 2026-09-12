import {
  type Allocation,
  type Experiment,
  type ExperimentStatus,
  assertValidAllocation,
} from "@/domain/experiment";
import { type Instant, instant } from "@/domain/time";
import { type Db, nullable, queryOne } from "../db";

interface Row {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number | null;
  window_hours: number;
  status: ExperimentStatus;
  paused_at: number | null;
  allocation: string;
  allocation_version: number;
}

const toExperiment = (r: Row): Experiment => {
  const allocation = JSON.parse(r.allocation) as Allocation[];
  assertValidAllocation(allocation);
  return {
    id: r.id,
    name: r.name,
    startsAt: instant(r.starts_at),
    endsAt: r.ends_at === null ? null : instant(r.ends_at),
    windowHours: r.window_hours,
    status: r.status,
    pausedAt: r.paused_at === null ? null : instant(r.paused_at),
    allocation,
    allocationVersion: r.allocation_version,
  };
};

/**
 * Inserts the experiment if missing. Deliberately NOT an upsert: a reseed
 * must not overwrite a status set through /admin, and allocation changes are
 * a versioned operation, not a fixture reload.
 */
export function insertExperimentIfMissing(db: Db, exp: Experiment): boolean {
  assertValidAllocation(exp.allocation);
  const result = db
    .prepare(`
      INSERT OR IGNORE INTO experiments
        (id, name, starts_at, ends_at, window_hours, status, paused_at, allocation, allocation_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      exp.id,
      exp.name,
      exp.startsAt,
      nullable(exp.endsAt),
      exp.windowHours,
      exp.status,
      nullable(exp.pausedAt),
      JSON.stringify(exp.allocation),
      exp.allocationVersion,
    );
  return result.changes === 1;
}

export function getExperiment(db: Db, id: string): Experiment | null {
  const row = queryOne<Row>(db, "SELECT * FROM experiments WHERE id = ?", id);
  return row ? toExperiment(row) : null;
}

export function setExperimentStatus(
  db: Db,
  id: string,
  status: ExperimentStatus,
  pausedAt: Instant | null,
): void {
  db.prepare("UPDATE experiments SET status = ?, paused_at = ? WHERE id = ?").run(status, pausedAt, id);
}
