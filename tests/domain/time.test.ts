// Why here: every timestamp in the system enters through parseInstant. If it
// accepts something ambiguous, or the process time zone leaks into it, every
// downstream number is wrong with no error. `npm run test:tz` runs this file
// under four time zones; the expectations must hold in all of them.
import { describe, expect, it } from "vitest";
import {
  InvalidInstant,
  days,
  elapsed,
  fixedClock,
  formatInstant,
  hours,
  instant,
  isWithin,
  minutes,
  parseInstant,
  plus,
} from "@/domain/time";

const AUG_1 = 1_785_542_400_000; // 2026-08-01T00:00:00Z

describe("parseInstant", () => {
  it("parses a Z timestamp independently of the process time zone", () => {
    expect(parseInstant("2026-08-01T00:00:00Z")).toBe(AUG_1);
    expect(parseInstant("2026-08-04T17:22:31Z")).toBe(Date.UTC(2026, 7, 4, 17, 22, 31));
  });

  it("honors an explicit offset (17:22:31+03:00 is 14:22:31Z)", () => {
    expect(parseInstant("2026-08-04T17:22:31+03:00")).toBe(parseInstant("2026-08-04T14:22:31Z"));
    expect(parseInstant("2026-08-04T17:22:31-03:00")).toBe(parseInstant("2026-08-04T20:22:31Z"));
    expect(parseInstant("2026-08-04T17:22:31+12:45")).toBe(parseInstant("2026-08-04T04:37:31Z"));
  });

  it("accepts 1–3 fractional digits, padding to milliseconds", () => {
    expect(parseInstant("2026-08-01T00:00:00.5Z")).toBe(AUG_1 + 500);
    expect(parseInstant("2026-08-01T00:00:00.050Z")).toBe(AUG_1 + 50);
  });

  it("rejects naive timestamps instead of guessing a zone", () => {
    expect(() => parseInstant("2026-08-01T00:00:00")).toThrow(InvalidInstant);
    expect(() => parseInstant("2026-08-01 00:00:00")).toThrow(InvalidInstant);
    expect(() => parseInstant("2026-08-01")).toThrow(InvalidInstant);
  });

  it("rejects malformed input and non-strings", () => {
    for (const bad of ["", "garbage", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-08-01T24:00:00Z", 123, null, undefined, {}]) {
      expect(() => parseInstant(bad)).toThrow(InvalidInstant);
    }
  });

  it("round-trips through formatInstant in canonical UTC form", () => {
    expect(formatInstant(parseInstant("2026-08-04T17:22:31Z"))).toBe("2026-08-04T17:22:31.000Z");
    expect(formatInstant(parseInstant("2026-08-04T17:22:31+03:00"))).toBe("2026-08-04T14:22:31.000Z");
  });
});

describe("instant", () => {
  it("brands safe integers and rejects anything else", () => {
    expect(instant(AUG_1)).toBe(AUG_1);
    expect(() => instant(1.5)).toThrow(InvalidInstant);
    expect(() => instant(Number.NaN)).toThrow(InvalidInstant);
  });
});

describe("durations and windows", () => {
  const signup = parseInstant("2026-08-03T10:00:00Z");
  const window = hours(168);

  it("builds durations in milliseconds", () => {
    expect(minutes(1)).toBe(60_000);
    expect(hours(1)).toBe(3_600_000);
    expect(days(7)).toBe(hours(168));
  });

  it("is inclusive at exactly 168h and exclusive one millisecond later", () => {
    expect(isWithin(signup, plus(signup, hours(167.99)), window)).toBe(true);
    expect(isWithin(signup, plus(signup, hours(168)), window)).toBe(true);
    expect(isWithin(signup, instant(plus(signup, hours(168)) + 1), window)).toBe(false);
  });

  it("never counts an instant before the start of the window", () => {
    expect(isWithin(signup, instant(signup - 1), window)).toBe(false);
    expect(elapsed(signup, instant(signup - 1))).toBe(-1);
  });
});

describe("clock", () => {
  it("fixedClock returns the same instant every time", () => {
    const c = fixedClock(instant(AUG_1));
    expect(c.now()).toBe(AUG_1);
    expect(c.now()).toBe(AUG_1);
  });
});
