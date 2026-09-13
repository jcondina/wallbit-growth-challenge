// Why here: the kill switch changes what every user sees from the next
// request on. Pausing must record when, must not touch assignments, and
// resuming must restore the assigned variants — all visible through
// enrollUser, which is what the funding page calls.
import { describe, expect, it } from "vitest";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";
import { fixedClock, parseInstant } from "@/domain/time";
import { openDb } from "@/infra/db";
import { countAssignmentsByVariant } from "@/infra/repos/assignments";
import { getExperiment } from "@/infra/repos/experiments";
import { getUser } from "@/infra/repos/users";
import { enrollUser } from "@/services/enrollUser";
import { setStatus } from "@/services/experimentControl";
import { seedDatabase } from "@/services/seed";

const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));
const ID = FUNDING_EXPERIMENT.id;

describe("setStatus", () => {
  it("pauses with a timestamp, keeps assignments, and enrollUser shows control", () => {
    const db = openDb(":memory:");
    seedDatabase(db, { clock });
    const out = setStatus(db, clock, ID, "paused");
    expect(out.kind).toBe("updated");
    expect(getExperiment(db, ID)).toMatchObject({ status: "paused", pausedAt: clock.now() });
    expect(countAssignmentsByVariant(db, ID)).toEqual({ A: 296, B: 304 });
    expect(enrollUser(db, clock, getUser(db, "usr_000871")!, getExperiment(db, ID)!)).toMatchObject({ variantShown: "A", reason: "paused" });
  });

  it("resumes and clears paused_at; assigned variants come back", () => {
    const db = openDb(":memory:");
    seedDatabase(db, { clock });
    setStatus(db, clock, ID, "paused");
    expect(setStatus(db, clock, ID, "running").kind).toBe("updated");
    expect(getExperiment(db, ID)).toMatchObject({ status: "running", pausedAt: null });
    expect(enrollUser(db, clock, getUser(db, "usr_000871")!, getExperiment(db, ID)!)).toMatchObject({ variantShown: "B", reason: "assigned" });
  });

  it("reports unchanged and not_found", () => {
    const db = openDb(":memory:");
    seedDatabase(db, { clock });
    expect(setStatus(db, clock, ID, "running").kind).toBe("unchanged");
    expect(setStatus(db, clock, "nope", "paused")).toEqual({ kind: "not_found" });
  });
});
