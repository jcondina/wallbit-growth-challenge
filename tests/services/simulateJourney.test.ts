// Why here: the simulator writes through the real services, so it must
// produce exactly the shapes the funnel expects, its deposits must be
// timed so the activation rule treats them like real ones, and — the
// property that keeps the deliverable honest — removing simulated data
// must restore the results byte for byte.
import { describe, expect, it } from "vitest";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";
import { fixedClock, parseInstant } from "@/domain/time";
import { openDb } from "@/infra/db";
import { experimentResults } from "@/services/experimentResults";
import { funnelResults } from "@/services/funnelResults";
import { seedDatabase } from "@/services/seed";
import { batchPool, deleteSimulatedData, mulberry32, simulateBatch, simulateJourney, simulatedCounts } from "@/services/simulateJourney";

const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));
const SECRET = "whsec_sandbox_wallbit";

function fresh() {
  const db = openDb(":memory:");
  seedDatabase(db, { clock });
  return { db, deps: { db, clock, secret: SECRET } };
}
const names = (r: { events: { name: string }[] }) => r.events.map((e) => e.name);

describe("simulateJourney", () => {
  it("emits the expected event shapes per journey, all accepted by the real services", () => {
    const { deps } = fresh();
    const rng = mulberry32(1);
    const viewed = simulateJourney(deps, "usr_000871", "viewed", rng);
    expect(names(viewed)).toEqual(["funding_screen_viewed", "funding_screen_left"]);
    const deposited = simulateJourney(deps, "usr_000601", "deposited", rng); // MX, variant A
    expect(names(deposited)).toEqual(["funding_screen_viewed", "funding_method_selected", "funding_details_copied", "funding_screen_left"]);
    expect(deposited.webhooks.map((w) => [w.type, w.outcome])).toEqual([["deposit.received", "processed"], ["deposit.completed", "processed"]]);
    expect([...viewed.events, ...deposited.events].every((e) => e.outcome === "stored")).toBe(true);
  });

  it("a B user follows the recommendation; an 'expanded' journey picks another method via the expanded list", () => {
    const { deps } = fresh();
    const primary = simulateJourney(deps, "usr_000871", "deposited", mulberry32(2)); // AR, variant B
    expect(primary.variantShown).toBe("B");
    expect(primary.methodId).toBe("local_ar");
    expect(primary.events.find((e) => e.name === "funding_method_selected")?.props).toMatchObject({ via: "primary", is_recommended: true });

    const expanded = simulateJourney(deps, "usr_000630", "expanded", mulberry32(3)); // CO, variant B
    expect(expanded.methodId).not.toBe("local_co");
    expect(names(expanded)).toContain("funding_options_expanded");
    expect(expanded.events.find((e) => e.name === "funding_method_selected")?.props).toMatchObject({ via: "expanded", is_recommended: false });
  });

  it("times deposits against the user's signup: 'deposited' activates, 'late' does not, 'failed' never does", () => {
    const { db, deps } = fresh();
    const rng = mulberry32(4);
    const before = experimentResults(db, { clock }).variants;
    simulateJourney(deps, "usr_001044", "deposited", rng); // MX, B, no real deposits
    simulateJourney(deps, "usr_000649", "late", rng); // BR, B
    simulateJourney(deps, "usr_000723", "failed", rng); // BO, B
    const after = experimentResults(db, { clock }).variants;
    expect(after.B.activated - before.B.activated).toBe(1);
    expect(after.B.lateConversions - before.B.lateConversions).toBe(1);
    expect(after.B.everConverted - before.B.everConverted).toBe(2);
    expect(before.B.failureRate).toBeNull(); // no webhook deposits yet → "sin datos"
    expect(after.B.failureRate).toEqual({ k: 1, n: 3 }); // 1 failed of 3 final simulated deposits
  });

  it("a pre-experiment user gets nothing simulated: a deposit of theirs would move the baseline", () => {
    const { db, deps } = fresh();
    const baseline = () => JSON.stringify(experimentResults(db, { clock }).baseline);
    const before = baseline();
    const report = simulateJourney(deps, "usr_000466", "deposited", mulberry32(5)); // BR, signed up 2026-04-30
    expect(report).toMatchObject({ reason: "ineligible", note: "ineligible", methodId: null, events: [], webhooks: [] });
    expect(simulatedCounts(db)).toEqual({ sessions: 0, clientEvents: 0, deposits: 0, webhooks: 0 });
    expect(baseline()).toBe(before);
  });

  it("'expanded' on a control user runs as a plain deposit, since A has no «otras opciones»", () => {
    const { deps } = fresh();
    const report = simulateJourney(deps, "usr_000601", "expanded", mulberry32(6)); // MX, variant A
    expect(report.variantShown).toBe("A");
    expect(report).toMatchObject({ journey: "deposited", note: "expanded_on_control" });
    expect(names(report)).not.toContain("funding_options_expanded");
    expect(report.webhooks).toHaveLength(2);
  });

  it("a batch stops at the fresh pool, and the pool shrinks by exactly the users it touched", () => {
    const { db, deps } = fresh();
    const experiment = { ...FUNDING_EXPERIMENT };
    simulateJourney(deps, "usr_000871", "deposited", mulberry32(8)); // a user with a deposit is no longer fresh
    const pool = batchPool(db, experiment).length;
    expect(pool).toBe(599);
    const reports = simulateBatch(deps, { users: 600, seed: 8 });
    expect(reports).toHaveLength(pool);
    expect(reports.every((r) => r.reason === "assigned" && r.note !== "ineligible")).toBe(true);
    expect(batchPool(db, experiment)).toHaveLength(0);
    expect(simulateBatch(deps, { users: 10, seed: 9 })).toHaveLength(0);
    expect(simulateBatch(deps, { users: 10, seed: 9, freshOnly: false })).toHaveLength(10);
  });

  it("batch is reproducible from its seed and only touches fresh users", () => {
    const a = fresh();
    const b = fresh();
    const ra = simulateBatch(a.deps, { users: 30, seed: 7 });
    const rb = simulateBatch(b.deps, { users: 30, seed: 7 });
    expect(ra.map((r) => [r.userId, r.journey, r.methodId])).toEqual(rb.map((r) => [r.userId, r.journey, r.methodId]));
    expect(new Set(ra.map((r) => r.userId)).size).toBe(30);
    const counts = simulatedCounts(a.db);
    expect(counts.sessions).toBeGreaterThanOrEqual(30);
    expect(funnelResults(a.db).exposedUsers).toBe(30);
  });

  it("deleting simulated data restores results and funnel byte for byte", () => {
    const { db, deps } = fresh();
    const snapshot = () => JSON.stringify([experimentResults(db, { clock }), { ...funnelResults(db), recent: undefined }]);
    const before = snapshot();
    simulateBatch(deps, { users: 50, seed: 11 });
    expect(snapshot()).not.toBe(before);
    expect(experimentResults(db, { clock }).dataQuality.simulatedDeposits).toBeGreaterThan(0);
    const removed = deleteSimulatedData(db);
    expect(removed.sessions).toBeGreaterThan(0);
    expect(simulatedCounts(db)).toEqual({ sessions: 0, clientEvents: 0, deposits: 0, webhooks: 0 });
    expect(snapshot()).toBe(before);
  });
});
