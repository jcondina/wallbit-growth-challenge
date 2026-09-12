import { type Instant, instant } from "@/domain/time";
import { type Db, bool, queryOne, queryRow } from "../db";

/** One row per delivery the provider made, deduplicated by event_id. */
export interface InboxEntry {
  eventId: string;
  eventType: string;
  depositId: string;
  occurredAt: Instant;
  receivedAt: Instant;
  signatureOk: boolean;
  headerMismatch: boolean;
  anomalies: string[];
  payload: string;
}

interface Row {
  event_id: string;
  event_type: string;
  deposit_id: string;
  occurred_at: number;
  received_at: number;
  signature_ok: 0 | 1;
  header_mismatch: 0 | 1;
  anomalies: string | null;
  payload: string;
}

const toEntry = (r: Row): InboxEntry => ({
  eventId: r.event_id,
  eventType: r.event_type,
  depositId: r.deposit_id,
  occurredAt: instant(r.occurred_at),
  receivedAt: instant(r.received_at),
  signatureOk: r.signature_ok === 1,
  headerMismatch: r.header_mismatch === 1,
  anomalies: r.anomalies === null ? [] : (JSON.parse(r.anomalies) as string[]),
  payload: r.payload,
});

/** Dedupe layer 1. Returns true for a first delivery, false for a redelivery of the same event_id. */
export function insertInboxIfMissing(db: Db, e: InboxEntry): boolean {
  const result = db
    .prepare(`
      INSERT OR IGNORE INTO webhook_inbox
        (event_id, event_type, deposit_id, occurred_at, received_at,
         signature_ok, header_mismatch, anomalies, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      e.eventId,
      e.eventType,
      e.depositId,
      e.occurredAt,
      e.receivedAt,
      bool(e.signatureOk),
      bool(e.headerMismatch),
      e.anomalies.length === 0 ? null : JSON.stringify(e.anomalies),
      e.payload,
    );
  return result.changes === 1;
}

export function getInboxEntry(db: Db, eventId: string): InboxEntry | null {
  const row = queryOne<Row>(db, "SELECT * FROM webhook_inbox WHERE event_id = ?", eventId);
  return row ? toEntry(row) : null;
}

export interface InboxStats {
  uniqueEvents: number;
  withAnomalies: number;
  headerMismatches: number;
  unsigned: number;
  lastOccurredAt: Instant | null;
}

export function inboxStats(db: Db): InboxStats {
  const r = queryRow<{
    unique_events: number;
    with_anomalies: number | null;
    header_mismatches: number | null;
    unsigned: number | null;
    last_occurred_at: number | null;
  }>(db, `
      SELECT COUNT(*) AS unique_events,
             SUM(CASE WHEN anomalies IS NOT NULL THEN 1 ELSE 0 END) AS with_anomalies,
             SUM(header_mismatch) AS header_mismatches,
             SUM(CASE WHEN signature_ok = 0 THEN 1 ELSE 0 END) AS unsigned,
             MAX(occurred_at) AS last_occurred_at
      FROM webhook_inbox
    `);
  return {
    uniqueEvents: r.unique_events,
    withAnomalies: r.with_anomalies ?? 0,
    headerMismatches: r.header_mismatches ?? 0,
    unsigned: r.unsigned ?? 0,
    lastOccurredAt: r.last_occurred_at === null ? null : instant(r.last_occurred_at),
  };
}
