// Why here: this decides what a user sees, and whether they enter the
// denominator. Ineligible users and paused experiments must show control
// without writing anything; a first touch must write exactly once.
import { describe, expect, it } from "vitest";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";
import { fixedClock, parseInstant } from "@/domain/time";
import { openDb, queryRow } from "@/infra/db";
import { getAssignment } from "@/infra/repos/assignments";
import { getExperiment, setExperimentStatus } from "@/infra/repos/experiments";
import { getUser, upsertUsers } from "@/infra/repos/users";
import { UnknownVariant, enrollUser } from "@/services/enrollUser";
import { seedDatabase } from "@/services/seed";

const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));

function fresh() {
  const db = openDb(":memory:");
  seedDatabase(db, { clock });
  const experiment = getExperiment(db, FUNDING_EXPERIMENT.id)!;
  return { db, experiment };
}
const events = (db: ReturnType<typeof openDb>) => queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM events").n;

describe("enrollUser", () => {
  it("returns the stored variant for an already-enrolled user", () => {
    const { db, experiment } = fresh();
    const out = enrollUser(db, clock, getUser(db, "usr_000871")!, experiment);
    expect(out.reason).toBe("assigned");
    expect(out.variantShown).toBe("B");
    expect(out.assignment?.assignedAt).toBe(parseInstant("2026-08-02T08:50:12Z"));
  });

  it("shows control to a pre-experiment user and never enrolls them", () => {
    const { db, experiment } = fresh();
    const before = events(db);
    const out = enrollUser(db, clock, getUser(db, "usr_000466")!, experiment);
    expect(out).toMatchObject({ variantShown: "A", assignment: null, reason: "ineligible" });
    expect(getAssignment(db, experiment.id, "usr_000466")).toBeNull();
    expect(events(db)).toBe(before);
  });

  it("enrolls a new eligible user on first touch, exactly once", () => {
    const { db, experiment } = fresh();
    upsertUsers(db, [{ id: "usr_new", email: "n@example.com", country: "UY", createdAt: parseInstant("2026-08-20T10:00:00Z"), kycStatus: "approved" }]);
    const user = getUser(db, "usr_new")!;
    const before = events(db);
    const first = enrollUser(db, clock, user, experiment);
    expect(first.reason).toBe("enrolled");
    expect(first.assignment?.assignedAt).toBe(clock.now());
    expect(events(db)).toBe(before + 1);
    const second = enrollUser(db, clock, user, experiment);
    expect(second.reason).toBe("assigned");
    expect(second.variantShown).toBe(first.variantShown);
    expect(events(db)).toBe(before + 1);
  });

  it("paused: control for everyone, existing assignments untouched, no new enrollments", () => {
    const { db } = fresh();
    setExperimentStatus(db, FUNDING_EXPERIMENT.id, "paused", clock.now());
    const paused = getExperiment(db, FUNDING_EXPERIMENT.id)!;
    const out = enrollUser(db, clock, getUser(db, "usr_000871")!, paused);
    expect(out).toMatchObject({ variantShown: "A", reason: "paused" });
    expect(out.assignment?.variant).toBe("B"); // kept
    upsertUsers(db, [{ id: "usr_new", email: "n@example.com", country: "AR", createdAt: parseInstant("2026-08-20T10:00:00Z"), kycStatus: "approved" }]);
    const fresh_ = enrollUser(db, clock, getUser(db, "usr_new")!, paused);
    expect(fresh_).toMatchObject({ variantShown: "A", assignment: null, reason: "paused" });
    expect(getAssignment(db, paused.id, "usr_new")).toBeNull();
  });

  it("preview: the requested variant, nothing written", () => {
    const { db, experiment } = fresh();
    const before = events(db);
    expect(enrollUser(db, clock, getUser(db, "usr_000466")!, experiment, { preview: "B" })).toMatchObject({ variantShown: "B", reason: "preview" });
    expect(events(db)).toBe(before);
    expect(() => enrollUser(db, clock, getUser(db, "usr_000466")!, experiment, { preview: "Z" })).toThrow(UnknownVariant);
  });
});
