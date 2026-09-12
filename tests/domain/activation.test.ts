// Why here: this is the metric. 254 users complete a deposit in the scenario
// but only 210 do it within 168h; 45 deposits fail; a few users fail first
// and succeed later. Every one of those distinctions is a line below.
import { describe, expect, it } from "vitest";
import { firstCompletedAt, firstInitiatedAt, isActivated, summarizeActivation } from "@/domain/activation";
import type { DepositState } from "@/domain/deposit";
import { hours, instant, parseInstant, plus } from "@/domain/time";

const signup = parseInstant("2026-08-03T10:00:00Z");
const window = hours(168);
const asOf = parseInstant("2026-09-12T00:00:00Z");

function dep(partial: Partial<DepositState> & { id: string }): DepositState {
  return {
    userId: "u",
    methodId: "local_ar",
    amountUsd: 100,
    currency: "ARS",
    country: "AR",
    status: "received",
    initiatedAt: null,
    completedAt: null,
    failedAt: null,
    ...partial,
  };
}

describe("isActivated boundaries", () => {
  it("counts a completion at exactly 168h and rejects one millisecond later", () => {
    expect(isActivated(signup, plus(signup, hours(167.99)), window)).toBe(true);
    expect(isActivated(signup, plus(signup, hours(168)), window)).toBe(true);
    expect(isActivated(signup, instant(plus(signup, hours(168)) + 1), window)).toBe(false);
  });

  it("never counts a completion before signup or no completion at all", () => {
    expect(isActivated(signup, instant(signup - 1), window)).toBe(false);
    expect(isActivated(signup, null, window)).toBe(false);
  });
});

describe("first deposit selection", () => {
  it("uses the earliest credited deposit and ignores received / failed / conflict", () => {
    const deposits = [
      dep({ id: "d1", status: "failed", failedAt: plus(signup, hours(2)) }),
      dep({ id: "d2", status: "received", initiatedAt: plus(signup, hours(3)) }),
      dep({ id: "d3", status: "completed", initiatedAt: plus(signup, hours(30)), completedAt: plus(signup, hours(50)) }),
      dep({ id: "d4", status: "completed", initiatedAt: plus(signup, hours(10)), completedAt: plus(signup, hours(40)) }),
      dep({ id: "d5", status: "conflict", completedAt: plus(signup, hours(1)), failedAt: plus(signup, hours(1)) }),
    ];
    expect(firstCompletedAt(deposits)).toBe(plus(signup, hours(40)));
    expect(firstInitiatedAt(deposits)).toBe(plus(signup, hours(10)));
  });

  it("returns null when nothing credited", () => {
    expect(firstCompletedAt([dep({ id: "d1", status: "failed", failedAt: signup })])).toBeNull();
    expect(firstCompletedAt([])).toBeNull();
  });
});

describe("summarizeActivation", () => {
  it("activated: credited inside the window", () => {
    const s = summarizeActivation(signup, [dep({ id: "d", status: "completed", initiatedAt: plus(signup, hours(20)), completedAt: plus(signup, hours(44)) })], window, asOf);
    expect(s).toMatchObject({ activated: true, lateConversion: false, initiatedInWindow: true, windowClosed: true });
    expect(s.windowEndsAt).toBe(plus(signup, hours(168)));
  });

  it("late conversion: initiated inside the window, credited after it (the settlement gap)", () => {
    const s = summarizeActivation(signup, [dep({ id: "d", status: "completed", initiatedAt: plus(signup, hours(160)), completedAt: plus(signup, hours(190)) })], window, asOf);
    expect(s).toMatchObject({ activated: false, lateConversion: true, initiatedInWindow: true });
  });

  it("failed first, credited later inside the window still activates", () => {
    const s = summarizeActivation(
      signup,
      [
        dep({ id: "d1", status: "failed", initiatedAt: plus(signup, hours(5)), failedAt: plus(signup, hours(20)) }),
        dep({ id: "d2", status: "completed", initiatedAt: plus(signup, hours(50)), completedAt: plus(signup, hours(70)) }),
      ],
      window,
      asOf,
    );
    expect(s.activated).toBe(true);
    expect(s.firstInitiatedAt).toBe(plus(signup, hours(50))); // the deposit that landed, not the one that failed
  });

  it("only failures: not activated, not late", () => {
    const s = summarizeActivation(signup, [dep({ id: "d", status: "failed", failedAt: plus(signup, hours(20)) })], window, asOf);
    expect(s).toMatchObject({ activated: false, lateConversion: false, firstCompletedAt: null });
  });

  it("reports an open window when asOf is inside it (right-censoring)", () => {
    const s = summarizeActivation(signup, [], window, plus(signup, hours(100)));
    expect(s.windowClosed).toBe(false);
    expect(summarizeActivation(signup, [], window, plus(signup, hours(168))).windowClosed).toBe(true);
  });
});
