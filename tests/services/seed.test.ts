// Why here: the seed defines the denominator (600 enrolled) and must be safe
// to run twice — an evaluator will. Both are acceptance criteria, so they
// are pinned by a test rather than a README promise.
import { describe, expect, it } from "vitest";
import { fixedClock, parseInstant } from "@/domain/time";
import { openDb } from "@/infra/db";
import { getAssignment } from "@/infra/repos/assignments";
import { getDeposit } from "@/infra/repos/deposits";
import { getExperiment, setExperimentStatus } from "@/infra/repos/experiments";
import { seedDatabase } from "@/services/seed";

const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));

describe("seedDatabase", () => {
  it("loads the fixtures and enrolls exactly the eligible users", () => {
    const db = openDb(":memory:");
    const r = seedDatabase(db, { clock });
    expect(r.users).toEqual({ total: 1200, added: 1200 });
    expect(r.methods).toEqual({ total: 16, added: 16 });
    expect(r.historicalDeposits).toEqual({ total: 201, added: 201 });
    expect(r.experiment).toEqual({ id: "funding_recommended_v1", created: true });
    expect(r.assignments).toEqual({ byVariant: { A: 296, B: 304 }, added: 600, ineligible: 600 });
    expect(r.events).toEqual({ total: 600, added: 600 });
  });

  it("is idempotent: a second run adds nothing", () => {
    const db = openDb(":memory:");
    seedDatabase(db, { clock });
    const r = seedDatabase(db, { clock });
    expect(r.users.added).toBe(0);
    expect(r.methods.added).toBe(0);
    expect(r.historicalDeposits.added).toBe(0);
    expect(r.experiment.created).toBe(false);
    expect(r.assignments.added).toBe(0);
    expect(r.events.added).toBe(0);
    expect(r.assignments.byVariant).toEqual({ A: 296, B: 304 });
  });

  it("assigns at signup time and keeps pre-experiment users out", () => {
    const db = openDb(":memory:");
    seedDatabase(db, { clock });
    const enrolled = getAssignment(db, "funding_recommended_v1", "usr_000871");
    expect(enrolled?.variant).toBe("B");
    expect(enrolled?.assignedAt).toBe(parseInstant("2026-08-02T08:50:12Z")); // = users.json created_at
    expect(getAssignment(db, "funding_recommended_v1", "usr_000466")).toBeNull(); // signed up 2026-04-30
  });

  it("stores historical deposits with initiated/completed instants and source=historical", () => {
    const db = openDb(":memory:");
    seedDatabase(db, { clock });
    const d = getDeposit(db, "dep_000001");
    expect(d).toMatchObject({
      userId: "usr_000466",
      methodId: "crypto_usdc",
      status: "completed",
      source: "historical",
      userKnown: true,
      initiatedAt: parseInstant("2026-05-02T11:48:36Z"),
      completedAt: parseInstant("2026-05-02T15:23:23Z"),
      failedAt: null,
    });
  });

  it("does not overwrite an experiment status set through admin", () => {
    const db = openDb(":memory:");
    seedDatabase(db, { clock });
    setExperimentStatus(db, "funding_recommended_v1", "paused", clock.now());
    seedDatabase(db, { clock });
    expect(getExperiment(db, "funding_recommended_v1")?.status).toBe("paused");
  });
});
