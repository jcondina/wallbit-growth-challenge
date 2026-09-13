import type { EventEnvelope, EventName, EventSource } from "@/domain/events";
import { instant } from "@/domain/time";
import { type Db, nullable, queryAll, queryRow } from "../db";

interface Row {
  event_id: string;
  name: EventName;
  user_id: string;
  occurred_at: number;
  recorded_at: number;
  source: EventSource;
  experiment_id: string | null;
  variant_shown: string | null;
  country: string | null;
  session_id: string | null;
  schema_version: number;
  props: string;
}

const toEvent = (r: Row): EventEnvelope => ({
  eventId: r.event_id,
  name: r.name,
  userId: r.user_id,
  occurredAt: instant(r.occurred_at),
  recordedAt: instant(r.recorded_at),
  source: r.source,
  experimentId: r.experiment_id,
  variantShown: r.variant_shown,
  country: r.country,
  sessionId: r.session_id,
  schemaVersion: r.schema_version,
  props: JSON.parse(r.props) as Record<string, unknown>,
});

/** Append-only. Returns true when stored, false when `eventId` was already there. */
export function insertEventIfMissing(db: Db, e: EventEnvelope): boolean {
  const result = db
    .prepare(`
      INSERT OR IGNORE INTO events
        (event_id, name, user_id, occurred_at, recorded_at, source,
         experiment_id, variant_shown, country, session_id, schema_version, props)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      e.eventId,
      e.name,
      e.userId,
      e.occurredAt,
      e.recordedAt,
      e.source,
      nullable(e.experimentId),
      nullable(e.variantShown),
      nullable(e.country),
      nullable(e.sessionId),
      e.schemaVersion,
      JSON.stringify(e.props),
    );
  return result.changes === 1;
}

export function listEventsByUser(db: Db, userId: string): EventEnvelope[] {
  return (
    queryAll<Row>(db, "SELECT * FROM events WHERE user_id = ? ORDER BY occurred_at, rowid", userId)
  ).map(toEvent);
}

/** Everything stamped with the experiment, oldest first — the funnel's input. */
export function listEventsForExperiment(db: Db, experimentId: string): EventEnvelope[] {
  return (
    queryAll<Row>(db, "SELECT * FROM events WHERE experiment_id = ? ORDER BY occurred_at, rowid", experimentId)
  ).map(toEvent);
}

/** Client events whose variant_shown disagrees with the stored assignment (paused experiment, or a bug). */
export function countVariantMismatches(db: Db, experimentId: string): number {
  return queryRow<{ n: number }>(db, `
      SELECT COUNT(*) AS n FROM events e
      JOIN assignments a ON a.experiment_id = e.experiment_id AND a.user_id = e.user_id
      WHERE e.experiment_id = ? AND e.source = 'client' AND e.variant_shown != a.variant
    `, experimentId).n;
}

export function listRecentEvents(db: Db, limit: number): EventEnvelope[] {
  return (
    queryAll<Row>(db, "SELECT * FROM events ORDER BY recorded_at DESC, rowid DESC LIMIT ?", limit)
  ).map(toEvent);
}

export function countEventsByName(db: Db): Record<string, number> {
  const rows = queryAll<{
    name: string;
    n: number;
  }>(db, "SELECT name, COUNT(*) AS n FROM events GROUP BY name");
  return Object.fromEntries(rows.map((r) => [r.name, r.n]));
}
