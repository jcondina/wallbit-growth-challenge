// Why here: the read model is what the page and the endpoint serve. It is
// checked end to end — seed, ingest the whole scenario, read — against the
// reference numbers, and the baseline must come out of the same code path
// with the same definition.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixedClock, parseInstant } from "@/domain/time";
import { openDb } from "@/infra/db";
import { experimentResults } from "@/services/experimentResults";
import { ingestWebhook } from "@/services/ingestWebhook";
import { seedDatabase } from "@/services/seed";
import { signBody } from "@/services/webhookSignature";

const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));
const SECRET = "whsec_sandbox_wallbit";

function seededAndReplayed() {
  const db = openDb(":memory:");
  seedDatabase(db, { clock });
  const scenario = JSON.parse(readFileSync("simulator/scenario.json", "utf8")) as { events: { event_id: string; type: string }[] };
  for (const e of scenario.events) {
    const rawBody = Buffer.from(JSON.stringify(e), "utf8");
    ingestWebhook({ db, clock, secret: SECRET, verifySignature: true }, { rawBody, headers: { signature: signBody(SECRET, rawBody), eventId: e.event_id, eventType: e.type } });
  }
  return db;
}

describe("experimentResults", () => {
  const db = seededAndReplayed();
  const r = experimentResults(db, { clock });

  it("primary: A 113/296 (38.2 %), B 97/304 (31.9 %), all windows closed", () => {
    expect(r.variants.A).toMatchObject({ users: 296, activated: 113, pendingWindows: 0 });
    expect(r.variants.B).toMatchObject({ users: 304, activated: 97, pendingWindows: 0 });
    expect(r.variants.A.rate!).toBeCloseTo(0.382, 3);
    expect(r.variants.B.rate!).toBeCloseTo(0.319, 3);
    expect(r.variants.A.lateConversions + r.variants.B.lateConversions).toBe(44);
    expect(r.variants.A.everConverted + r.variants.B.everConverted).toBe(254);
  });

  it("comparison and verdict: −6.3 pp, p ≈ 0.11, no detectable difference", () => {
    expect(r.comparison!.difference!).toBeCloseTo(-0.063, 3);
    expect(r.comparison!.test!.p).toBeCloseTo(0.108, 2);
    expect(r.verdict!.state).toBe("no_detectable_difference");
    expect(r.verdict!.provisional).toBe(false);
  });

  it("baseline through the same definition: 138/600 credited, 163 initiated, 201 ever", () => {
    expect(r.baseline).toMatchObject({ users: 600, activated: 138, initiatedInWindow: 163, everConverted: 201, lateConversions: 63 });
    expect(r.baseline.rate!).toBeCloseTo(0.23, 3);
    expect(r.baseline.byCountry.AR).toMatchObject({ users: 238, activated: 54 });
    expect(r.baseline.byCountry.PE).toMatchObject({ users: 49, activated: 4 });
    expect(r.baseline.failureRate).toBeNull(); // historical data carries no failures
  });

  it("sanity: control is NOT consistent with the baseline (z ≈ 4.8)", () => {
    expect(r.sanity.controlVsBaseline!.z).toBeCloseTo(4.76, 1);
    expect(r.sanity.consistent).toBe(false);
  });

  it("mechanism: recommended-method share and timing are measured among ever-converted users", () => {
    // denominators are the ever-converted users of each group (201 baseline, 254 experiment)
    expect(r.baseline.usedRecommended!.n).toBe(201);
    expect(r.variants.A.usedRecommended!.n + r.variants.B.usedRecommended!.n).toBe(254);
    expect(r.baseline.medianDaysToInitiate!).toBeGreaterThan(2);
    expect(r.variants.A.medianHoursToCredit!).toBeGreaterThan(1);
  });

  it("guardrails: failure rates only from webhook deposits (45 failed of 299 final)", () => {
    const failed = r.variants.A.failureRate!.k + r.variants.B.failureRate!.k;
    const final = r.variants.A.failureRate!.n + r.variants.B.failureRate!.n;
    expect([failed, final]).toEqual([45, 299]);
    expect(r.variants.A.medianFirstDepositUsd).toBeGreaterThan(50);
  });

  it("country cuts: ten countries, small-sample flags, largest first", () => {
    expect(r.byCountry).toHaveLength(10);
    expect(r.byCountry[0].country).toBe("AR");
    expect(r.byCountry.find((c) => c.country === "DO")!.smallSample).toBe(true);
    expect(r.byCountry.find((c) => c.country === "AR")!.smallSample).toBe(false);
    const total = r.byCountry.reduce((acc, c) => acc + c.variants.A.users + c.variants.B.users, 0);
    expect(total).toBe(600);
  });

  it("data quality: 648 deliveries, 606 unique, 42 duplicates, 8 resends, 299 deposits, no anomalies", () => {
    expect(r.dataQuality.inbox).toMatchObject({ deliveries: 648, uniqueEvents: 606, resends: 8, withAnomalies: 0, unsigned: 0, headerMismatches: 0 });
    expect(r.dataQuality.duplicatesIgnored).toBe(42);
    expect(r.dataQuality.deposits).toEqual({ total: 299, completed: 254, failed: 45, conflict: 0, received: 0 });
    expect(r.dataQuality.unknownUsers).toBe(0);
    expect(r.dataQuality.assignmentsMissingForDepositors).toBe(0);
    expect(r.dataThrough).toBe(parseInstant("2026-08-30T15:27:00Z"));
  });

  it("client funnel is null before any screen has been instrumented", () => {
    expect(r.client).toBeNull();
  });

  it("power: MDE ≈ 11 pp at the control rate, P(B > A) ≈ 5 %, sample table monotonic", () => {
    expect(r.power.baseRate!).toBeCloseTo(0.382, 3);
    expect(r.power.mde!).toBeGreaterThan(0.1);
    expect(r.power.mde!).toBeLessThan(0.12);
    expect(r.power.probabilityTreatmentBeatsControl!).toBeLessThan(0.1);
    expect(r.power.table.map((t) => t.lift)).toEqual([0.03, 0.05, 0.08, 0.1]);
    expect(r.power.table[0].usersNeeded!).toBeGreaterThan(r.power.table[3].usersNeeded!);
    expect(r.power.signupsPerMonthObserved!).toBeGreaterThan(1000); // 600 signups in ~11 days
  });

  it("asOf inside the experiment marks open windows and a provisional verdict", () => {
    const early = experimentResults(db, { asOf: parseInstant("2026-08-05T00:00:00Z") });
    expect(early.variants.A.pendingWindows + early.variants.B.pendingWindows).toBeGreaterThan(0);
    expect(early.verdict!.provisional).toBe(true);
  });
});
