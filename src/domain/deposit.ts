import type { DepositEvent, DepositEventType } from "./provider";
import type { Instant } from "./time";

/**
 * Deposit state and the reducer that folds provider events into it.
 *
 * The provider delivers at-least-once, out of order, and sometimes under a
 * fresh event_id (PROVIDER.md). The reducer is written so that EVERY
 * permutation of a deposit's events — with duplicates — reaches the same
 * final state. That property is what tests/domain/deposit.test.ts checks.
 *
 * Rules
 *   - A deposit is created from whatever event arrives first, including a
 *     final one (the very first event in the scenario is a `failed`).
 *   - Each type owns one timestamp: received → initiatedAt, completed →
 *     completedAt, failed → failedAt. A timestamp is the EARLIEST
 *     occurred_at seen for its type ("hora del hecho"), never the latest.
 *   - Filling a previously-null timestamp is a *transition*: it happens once
 *     per (deposit, type), so a resend under a new event_id is a no-op and
 *     domain events are emitted exactly once.
 *   - Status is derived from which timestamps exist, with precedence
 *     completed/failed > received. Both finals present ⇒ `conflict`, which
 *     is never counted as an activation.
 *   - user/method are frozen on first sight; a later event that disagrees is
 *     flagged, not applied (the scenario has no such drift).
 *   - amount/currency/country come from the highest-precedence event TYPE
 *     seen (completed > failed > received), never from arrival order. FX can
 *     move between received and completed, so the credited amount wins.
 */

export type DepositStatus = "received" | "completed" | "failed" | "conflict";

export interface DepositState {
  id: string;
  userId: string;
  methodId: string;
  amountUsd: number;
  currency: string | null;
  country: string | null;
  status: DepositStatus;
  initiatedAt: Instant | null;
  completedAt: Instant | null;
  failedAt: Instant | null;
}

export type DepositAnomaly = "user_mismatch" | "method_mismatch";

export interface ReduceResult {
  state: DepositState;
  /** False when the event carried nothing new (exact duplicate or resend). */
  changed: boolean;
  /** Types whose timestamp was set for the first time by this event. */
  transitions: DepositEventType[];
  anomalies: DepositAnomaly[];
}

const TIMESTAMP_FIELD: Record<DepositEventType, "initiatedAt" | "completedAt" | "failedAt"> = {
  received: "initiatedAt",
  completed: "completedAt",
  failed: "failedAt",
};

const FINAL_TYPES: ReadonlySet<DepositEventType> = new Set(["completed", "failed"]);

export function isFinalType(type: DepositEventType): boolean {
  return FINAL_TYPES.has(type);
}

// Which event type currently "owns" the payload fields, and its rank.
const PAYLOAD_RANK: Record<DepositEventType, number> = { received: 1, failed: 2, completed: 3 };

function payloadRankOf(s: Pick<DepositState, "completedAt" | "failedAt">): number {
  if (s.completedAt !== null) return PAYLOAD_RANK.completed;
  if (s.failedAt !== null) return PAYLOAD_RANK.failed;
  return PAYLOAD_RANK.received;
}

/** Status is a pure function of which timestamps exist. */
export function statusOf(s: Pick<DepositState, "completedAt" | "failedAt">): DepositStatus {
  if (s.completedAt !== null && s.failedAt !== null) return "conflict";
  if (s.completedAt !== null) return "completed";
  if (s.failedAt !== null) return "failed";
  return "received";
}

export function applyDepositEvent(current: DepositState | null, ev: DepositEvent): ReduceResult {
  const field = TIMESTAMP_FIELD[ev.type];

  if (current === null) {
    const fresh: DepositState = {
      id: ev.depositId,
      userId: ev.userId,
      methodId: ev.methodId,
      amountUsd: ev.amountUsd,
      currency: ev.currency,
      country: ev.country,
      status: "received",
      initiatedAt: null,
      completedAt: null,
      failedAt: null,
    };
    fresh[field] = ev.occurredAt;
    fresh.status = statusOf(fresh);
    return { state: fresh, changed: true, transitions: [ev.type], anomalies: [] };
  }

  const anomalies: DepositAnomaly[] = [];
  if (ev.userId !== current.userId) anomalies.push("user_mismatch");
  if (ev.methodId !== current.methodId) anomalies.push("method_mismatch");

  const next: DepositState = { ...current };
  const transitions: DepositEventType[] = [];

  const existing = current[field];
  if (existing === null) {
    next[field] = ev.occurredAt;
    transitions.push(ev.type);
  } else if (ev.occurredAt < existing) {
    next[field] = ev.occurredAt;
  }

  if (PAYLOAD_RANK[ev.type] >= payloadRankOf(current)) {
    next.amountUsd = ev.amountUsd;
    next.currency = ev.currency;
    next.country = ev.country;
  }
  next.status = statusOf(next);

  return { state: next, changed: !sameState(current, next), transitions, anomalies };
}

function sameState(a: DepositState, b: DepositState): boolean {
  return (
    a.amountUsd === b.amountUsd &&
    a.currency === b.currency &&
    a.country === b.country &&
    a.status === b.status &&
    a.initiatedAt === b.initiatedAt &&
    a.completedAt === b.completedAt &&
    a.failedAt === b.failedAt
  );
}

/** Folds a whole sequence; convenient for tests and for the in-process replay. */
export function reduceDepositEvents(events: DepositEvent[]): DepositState | null {
  let state: DepositState | null = null;
  for (const ev of events) state = applyDepositEvent(state, ev).state;
  return state;
}
