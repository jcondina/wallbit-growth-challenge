// Why here: this decides the sentence Growth reads. Four states and the
// provisional flag, each pinned; the August numbers must land on
// "no detectable difference", never on "A is better".
import { describe, expect, it } from "vitest";
import { decideVerdict } from "@/domain/verdict";
import { verdictText } from "@/content/verdict";

const base = { controlLabel: "A", treatmentLabel: "B", pendingWindows: 0 };

describe("decideVerdict", () => {
  it("August → no detectable difference, with the MDE attached", () => {
    const v = decideVerdict({ ...base, control: { k: 113, n: 296 }, treatment: { k: 97, n: 304 } });
    expect(v.state).toBe("no_detectable_difference");
    expect(v.difference!).toBeCloseTo(-0.063, 3);
    expect(v.test!.p).toBeCloseTo(0.108, 2);
    expect(v.mde!).toBeGreaterThan(0.1);
    expect(v.provisional).toBe(false);
    const text = verdictText(v);
    expect(text).toMatch(/^No hay diferencia detectable entre A y B\./);
    expect(text).toContain("−6,3 pp");
    expect(text).toContain("p = 0,11");
    expect(text).toContain("potencia 80 %");
  });

  it("b_better when p < α and the difference is positive", () => {
    const v = decideVerdict({ ...base, control: { k: 100, n: 400 }, treatment: { k: 150, n: 400 } });
    expect(v.state).toBe("b_better");
    expect(verdictText(v)).toMatch(/^B convierte mejor que A\. B − A = \+12,5 pp/);
  });

  it("a_better when p < α and the difference is negative", () => {
    const v = decideVerdict({ ...base, control: { k: 150, n: 400 }, treatment: { k: 100, n: 400 } });
    expect(v.state).toBe("a_better");
    expect(verdictText(v)).toMatch(/^A convierte mejor que B\./);
  });

  it("insufficient_data below 50 per arm or with an empty arm", () => {
    expect(decideVerdict({ ...base, control: { k: 10, n: 49 }, treatment: { k: 10, n: 300 } }).state).toBe("insufficient_data");
    expect(decideVerdict({ ...base, control: { k: 0, n: 0 }, treatment: { k: 10, n: 300 } }).state).toBe("insufficient_data");
    expect(verdictText(decideVerdict({ ...base, control: { k: 0, n: 0 }, treatment: { k: 0, n: 0 } }))).toMatch(/^Datos insuficientes/);
  });

  it("flags provisional when windows are still open", () => {
    const v = decideVerdict({ ...base, control: { k: 113, n: 296 }, treatment: { k: 97, n: 304 }, pendingWindows: 12 });
    expect(v.provisional).toBe(true);
    expect(verdictText(v)).toContain("provisional: 12 ventanas todavía abiertas");
  });

  it("prints the thresholds it used", () => {
    const v = decideVerdict({ ...base, control: { k: 113, n: 296 }, treatment: { k: 97, n: 304 } });
    expect(v.alpha).toBe(0.05);
    expect(v.minPerArm).toBe(50);
  });
});
