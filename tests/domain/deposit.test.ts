// Why here: this is the asynchronous-accreditation trap in the brief. The
// provider retries, reorders and resends under new ids; the reported result
// is only correct if the reducer lands on the same state for every delivery
// order. The permutation test below is the guarantee; the named cases are
// the specific shapes the scenario contains (first event is a `failed`,
// `completed` before `received`, resends).
import { describe, expect, it } from "vitest";
import { applyDepositEvent, reduceDepositEvents, statusOf } from "@/domain/deposit";
import type { DepositEvent, DepositEventType } from "@/domain/provider";
import { parseInstant } from "@/domain/time";

const at = parseInstant;

function ev(
  type: DepositEventType,
  occurredAt: string,
  overrides: Partial<DepositEvent> = {},
): DepositEvent {
  return {
    eventId: `evt_${type}_${occurredAt}`,
    type,
    occurredAt: at(occurredAt),
    depositId: "dep_1",
    userId: "usr_1",
    methodId: "local_ar",
    amountUsd: 100,
    currency: "ARS",
    country: "AR",
    ...overrides,
  };
}

const received = ev("received", "2026-08-02T09:00:00Z");
const completed = ev("completed", "2026-08-03T05:00:00Z", { amountUsd: 101.5 });
const failed = ev("failed", "2026-08-03T05:00:00Z");

describe("applyDepositEvent — creation", () => {
  it("creates from a `received`", () => {
    const r = applyDepositEvent(null, received);
    expect(r.state).toMatchObject({ status: "received", initiatedAt: received.occurredAt, completedAt: null, failedAt: null });
    expect(r.transitions).toEqual(["received"]);
    expect(r.changed).toBe(true);
  });

  it("creates from a `failed` that arrives first (scenario event #1, dep_100030)", () => {
    const r = applyDepositEvent(null, failed);
    expect(r.state).toMatchObject({ status: "failed", initiatedAt: null, failedAt: failed.occurredAt });
    expect(r.transitions).toEqual(["failed"]);
  });

  it("creates from a `completed` that arrives before its `received`", () => {
    const r = applyDepositEvent(null, completed);
    expect(r.state.status).toBe("completed");
    expect(r.state.initiatedAt).toBeNull();
  });
});

describe("applyDepositEvent — ordering and idempotency", () => {
  it("a late `received` fills initiatedAt and never regresses a completed deposit", () => {
    const first = applyDepositEvent(null, completed).state;
    const r = applyDepositEvent(first, received);
    expect(r.state.status).toBe("completed");
    expect(r.state.initiatedAt).toBe(received.occurredAt);
    expect(r.transitions).toEqual(["received"]);
    expect(r.changed).toBe(true);
  });

  it("an exact duplicate delivery is a no-op", () => {
    const s = reduceDepositEvents([received, completed]);
    const r = applyDepositEvent(s, completed);
    expect(r.changed).toBe(false);
    expect(r.transitions).toEqual([]);
    expect(r.state).toEqual(s);
  });

  it("a resend under a new event_id is a no-op too (dedupe is by deposit_id + type)", () => {
    const s = reduceDepositEvents([received, completed]);
    const r = applyDepositEvent(s, { ...completed, eventId: "evt_resend_999" });
    expect(r.changed).toBe(false);
    expect(r.transitions).toEqual([]);
  });

  it("keeps the earliest occurred_at per type without emitting a second transition", () => {
    const s = reduceDepositEvents([received, completed]);
    const earlier = { ...completed, eventId: "evt_x", occurredAt: at("2026-08-03T04:00:00Z") };
    const r = applyDepositEvent(s, earlier);
    expect(r.state.completedAt).toBe(earlier.occurredAt);
    expect(r.transitions).toEqual([]);
    expect(r.changed).toBe(true);
    // and a later one changes nothing
    const later = { ...completed, eventId: "evt_y", occurredAt: at("2026-08-03T06:00:00Z") };
    expect(applyDepositEvent(r.state, later).changed).toBe(false);
  });

  it("marks `conflict` when both finals exist, in either order", () => {
    expect(reduceDepositEvents([received, completed, failed])?.status).toBe("conflict");
    expect(reduceDepositEvents([failed, completed, received])?.status).toBe("conflict");
    expect(statusOf({ completedAt: at("2026-08-03T05:00:00Z"), failedAt: at("2026-08-03T05:00:00Z") })).toBe("conflict");
  });
});

describe("applyDepositEvent — payload rules", () => {
  it("payload follows the highest-precedence type: completed > failed > received", () => {
    expect(reduceDepositEvents([received, completed])?.amountUsd).toBe(101.5);
    expect(reduceDepositEvents([completed, received])?.amountUsd).toBe(101.5);
    // a `received` cannot override what a final event established…
    const s = reduceDepositEvents([received, completed])!;
    const r = applyDepositEvent(s, { ...received, eventId: "e2", amountUsd: 1, currency: "USD", country: "MX" });
    expect(r.state).toMatchObject({ amountUsd: 101.5, currency: "ARS", country: "AR" });
    // …but does set the fields while it is the only thing known
    expect(applyDepositEvent(null, { ...received, currency: "USD" }).state.currency).toBe("USD");
    // in a conflict the credited amount wins regardless of order
    expect(reduceDepositEvents([completed, failed])?.amountUsd).toBe(101.5);
    expect(reduceDepositEvents([failed, completed])?.amountUsd).toBe(101.5);
  });

  it("freezes user and method on first sight and flags disagreement", () => {
    const s = applyDepositEvent(null, received).state;
    const r = applyDepositEvent(s, { ...completed, userId: "usr_other", methodId: "wire_us" });
    expect(r.anomalies).toEqual(["user_mismatch", "method_mismatch"]);
    expect(r.state.userId).toBe("usr_1");
    expect(r.state.methodId).toBe("local_ar");
    expect(r.state.status).toBe("completed"); // the timestamp still applies
  });
});

// ---- the property: every delivery order, with duplicates, same final state

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((x, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [x, ...rest]),
  );
}

describe("order independence", () => {
  const resend = { ...completed, eventId: "evt_resend" };
  const cases: Record<string, DepositEvent[]> = {
    "received + completed": [received, completed],
    "received + failed": [received, failed],
    "received + completed + duplicate + resend": [received, completed, completed, resend],
    "received + completed + failed (conflict)": [received, completed, failed],
    "received twice + completed with earlier resend": [
      received,
      { ...received, eventId: "evt_r2" },
      completed,
      { ...completed, eventId: "evt_c2", occurredAt: at("2026-08-03T04:30:00Z") },
    ],
  };

  for (const [name, events] of Object.entries(cases)) {
    it(`reaches the same state for all ${permutations(events).length} orders: ${name}`, () => {
      const expected = reduceDepositEvents(events);
      for (const order of permutations(events)) {
        expect(reduceDepositEvents(order)).toEqual(expected);
      }
    });
  }

  it("emits each transition exactly once regardless of order", () => {
    const events = [received, completed, completed, resend];
    for (const order of permutations(events)) {
      const seen: DepositEventType[] = [];
      let state = null as ReturnType<typeof reduceDepositEvents>;
      for (const e of order) {
        const r = applyDepositEvent(state, e);
        seen.push(...r.transitions);
        state = r.state;
      }
      expect(seen.sort()).toEqual(["completed", "received"]);
    }
  });
});
