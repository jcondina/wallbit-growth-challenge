// Why here: this is the answer. The whole scenario (648 deliveries, with
// duplicates, resends and reordering) is folded through the pure domain and
// must land on the reference numbers from PLAN.md §19. No database, no HTTP —
// if this fails, the metric is wrong regardless of how it is served.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeActivation } from "@/domain/activation";
import { variantFor } from "@/domain/assignment";
import { type DepositState, applyDepositEvent } from "@/domain/deposit";
import { FUNDING_EXPERIMENT, activationWindow, isEligible } from "@/domain/experiment";
import { type DepositEvent, parseProviderEvent } from "@/domain/provider";
import { parseInstant } from "@/domain/time";

const exp = FUNDING_EXPERIMENT;
const asOf = parseInstant("2026-09-12T00:00:00Z");

const users = (JSON.parse(readFileSync("data/users.json", "utf8")) as { id: string; created_at: string }[]).map((u) => ({
  id: u.id,
  createdAt: parseInstant(u.created_at),
}));
const deliveries = (JSON.parse(readFileSync("simulator/scenario.json", "utf8")) as { events: unknown[] }).events.map(parseProviderEvent);

function replay(events: DepositEvent[]) {
  const deposits = new Map<string, DepositState>();
  const seenEventIds = new Set<string>();
  let duplicates = 0;
  let transitions = 0;
  for (const e of events) {
    if (seenEventIds.has(e.eventId)) {
      duplicates += 1;
      continue; // what the inbox does
    }
    seenEventIds.add(e.eventId);
    const r = applyDepositEvent(deposits.get(e.depositId) ?? null, e);
    deposits.set(e.depositId, r.state);
    transitions += r.transitions.length;
  }
  return { deposits, duplicates, uniqueEvents: seenEventIds.size, transitions };
}

describe("scenario replay through the domain", () => {
  const { deposits, duplicates, uniqueEvents, transitions } = replay(deliveries);

  it("deduplicates deliveries: 648 → 606 unique, 42 duplicates", () => {
    expect(deliveries.length).toBe(648);
    expect(uniqueEvents).toBe(606);
    expect(duplicates).toBe(42);
  });

  it("reaches 299 deposits: 254 completed, 45 failed, 0 conflict, 0 still received", () => {
    const counts = { received: 0, completed: 0, failed: 0, conflict: 0 };
    for (const d of deposits.values()) counts[d.status] += 1;
    expect(deposits.size).toBe(299);
    expect(counts).toEqual({ received: 0, completed: 254, failed: 45, conflict: 0 });
  });

  it("emits exactly one transition per (deposit, type): 606 unique events − 8 resends = 598", () => {
    expect(transitions).toBe(598);
  });

  it("activates 210 of the 600 eligible users (35.0 %)", () => {
    const byUser = new Map<string, DepositState[]>();
    for (const d of deposits.values()) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);

    let eligible = 0;
    let activated = 0;
    let late = 0;
    const split: Record<string, { users: number; activated: number }> = { A: { users: 0, activated: 0 }, B: { users: 0, activated: 0 } };
    for (const u of users) {
      if (!isEligible(exp, u)) continue;
      eligible += 1;
      const s = summarizeActivation(u.createdAt, byUser.get(u.id) ?? [], activationWindow(exp), asOf);
      const v = variantFor(exp, u.id);
      split[v].users += 1;
      if (s.activated) {
        activated += 1;
        split[v].activated += 1;
      }
      if (s.lateConversion) late += 1;
      expect(s.windowClosed).toBe(true);
    }
    expect(eligible).toBe(600);
    expect(activated).toBe(210);
    expect(late).toBe(44);
    expect(split).toEqual({ A: { users: 296, activated: 113 }, B: { users: 304, activated: 97 } });
  });

  it("is invariant to replaying the whole scenario twice", () => {
    const twice = replay([...deliveries, ...deliveries]);
    expect(twice.deposits).toEqual(deposits);
    expect(twice.uniqueEvents).toBe(606);
    expect(twice.transitions).toBe(598);
  });

  it("is invariant to reversing the delivery order", () => {
    const reversed = replay([...deliveries].reverse());
    expect(reversed.deposits).toEqual(deposits);
  });
});
