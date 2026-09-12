// Why here: eligibility decides the denominator. The 2026-08-01 cutoff has 5
// real users within three hours of it, so the boundary must be exact.
import { describe, expect, it } from "vitest";
import {
  FUNDING_EXPERIMENT,
  InvalidAllocation,
  activationWindow,
  assertValidAllocation,
  isEligible,
  isRunning,
} from "@/domain/experiment";
import { hours, instant, parseInstant } from "@/domain/time";

describe("isEligible", () => {
  const exp = FUNDING_EXPERIMENT;

  it("includes a signup at exactly the start instant (UTC midnight)", () => {
    expect(isEligible(exp, { createdAt: parseInstant("2026-08-01T00:00:00Z") })).toBe(true);
  });

  it("excludes a signup one millisecond before the start", () => {
    expect(isEligible(exp, { createdAt: instant(exp.startsAt - 1) })).toBe(false);
  });

  it("uses UTC midnight, not Argentina midnight (03:00Z)", () => {
    expect(isEligible(exp, { createdAt: parseInstant("2026-08-01T00:11:06Z") })).toBe(true);
  });

  it("respects an end instant when present", () => {
    const closed = { ...exp, endsAt: parseInstant("2026-09-01T00:00:00Z") };
    expect(isEligible(closed, { createdAt: parseInstant("2026-08-31T23:59:59Z") })).toBe(true);
    expect(isEligible(closed, { createdAt: parseInstant("2026-09-01T00:00:00Z") })).toBe(false);
  });
});

describe("experiment config", () => {
  it("has a 168h activation window and starts running", () => {
    expect(activationWindow(FUNDING_EXPERIMENT)).toBe(hours(168));
    expect(isRunning(FUNDING_EXPERIMENT)).toBe(true);
    expect(isRunning({ ...FUNDING_EXPERIMENT, status: "paused" })).toBe(false);
  });

  it("validates allocations", () => {
    expect(() => assertValidAllocation(FUNDING_EXPERIMENT.allocation)).not.toThrow();
    expect(() => assertValidAllocation([])).toThrow(InvalidAllocation);
    expect(() => assertValidAllocation([{ variant: "A", weight: 60 }, { variant: "B", weight: 60 }])).toThrow(/sum to 120/);
    expect(() => assertValidAllocation([{ variant: "A", weight: 50 }, { variant: "A", weight: 50 }])).toThrow(/twice/);
    expect(() => assertValidAllocation([{ variant: "A", weight: 100.5 }])).toThrow(InvalidAllocation);
  });
});
