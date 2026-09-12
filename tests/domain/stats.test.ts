// Why here: the verdict is only as honest as these functions. Each is
// checked against a hand-computed value (the August numbers, computed
// independently in Python during planning) and against its degenerate
// inputs, which must yield null rather than NaN.
import { describe, expect, it } from "vitest";
import {
  differenceCI,
  median,
  minDetectableEffect,
  normalCdf,
  probabilityTreatmentBeats,
  requiredPerArm,
  twoProportionZTest,
  wilsonCI,
} from "@/domain/stats";

const A = { k: 113, n: 296 };
const B = { k: 97, n: 304 };

describe("normalCdf", () => {
  it("matches known quantiles", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 5);
    expect(normalCdf(4.76)).toBeCloseTo(0.999999, 5);
  });
});

describe("twoProportionZTest (August: A 113/296 vs B 97/304)", () => {
  it("reproduces z = −1.609, p = 0.108", () => {
    const t = twoProportionZTest(A, B)!;
    expect(t.z).toBeCloseTo(-1.609, 2);
    expect(t.p).toBeCloseTo(0.108, 2);
  });

  it("control vs baseline (138/600 vs A) is z ≈ 4.76", () => {
    expect(twoProportionZTest({ k: 138, n: 600 }, A)!.z).toBeCloseTo(4.76, 1);
  });

  it("returns null for empty arms and degenerate pooled rates", () => {
    expect(twoProportionZTest({ k: 0, n: 0 }, B)).toBeNull();
    expect(twoProportionZTest({ k: 0, n: 10 }, { k: 0, n: 10 })).toBeNull();
    expect(twoProportionZTest({ k: 10, n: 10 }, { k: 10, n: 10 })).toBeNull();
  });
});

describe("intervals", () => {
  it("Wilson CI for A is about 32.9–43.8 % and stays inside [0, 1]", () => {
    const [lo, hi] = wilsonCI(A)!;
    expect(lo).toBeCloseTo(0.329, 2);
    expect(hi).toBeCloseTo(0.438, 2);
    expect(wilsonCI({ k: 0, n: 5 })![0]).toBe(0);
    expect(wilsonCI({ k: 5, n: 5 })![1]).toBe(1);
    expect(wilsonCI({ k: 0, n: 0 })).toBeNull();
  });

  it("difference CI (B − A) is about −13.9 to +1.4 pp", () => {
    const [lo, hi] = differenceCI(A, B)!;
    expect(lo).toBeCloseTo(-0.139, 2);
    expect(hi).toBeCloseTo(0.014, 2);
    expect(differenceCI({ k: 0, n: 0 }, B)).toBeNull();
  });
});

describe("power", () => {
  it("MDE at ~300 per arm from p = 0.23 is about +9.6 pp", () => {
    expect(minDetectableEffect(0.23, 300, 300)!).toBeCloseTo(0.096, 2);
    expect(minDetectableEffect(0.23, 0, 300)).toBeNull();
  });

  it("detecting +5 pp from 23 % needs ~1 192 per arm; +10 pp ~316", () => {
    expect(requiredPerArm(0.23, 0.28)).toBe(1192);
    expect(requiredPerArm(0.23, 0.33)).toBe(316);
    expect(requiredPerArm(0.23, 0.23)).toBeNull();
  });

  it("is monotonic: smaller lifts need more users", () => {
    const n = [0.03, 0.05, 0.08, 0.1].map((lift) => requiredPerArm(0.3, 0.3 + lift)!);
    expect(n).toEqual([...n].sort((a, b) => b - a));
  });
});

describe("probabilityTreatmentBeats", () => {
  it("is about 5 % for August and symmetric around equality", () => {
    expect(probabilityTreatmentBeats(A, B)!).toBeCloseTo(0.054, 1);
    expect(probabilityTreatmentBeats(A, A)!).toBeCloseTo(0.5, 6);
    expect(probabilityTreatmentBeats({ k: 0, n: 0 }, B)).toBeNull();
  });
});

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
