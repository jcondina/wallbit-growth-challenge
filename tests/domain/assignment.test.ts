// Why here: the reported result is a function of who lands in which bucket.
// The snapshot pins the hash so a "harmless" refactor cannot silently
// reshuffle 600 users; the balance check guards against a broken modulo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashBucket, variantFor } from "@/domain/assignment";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";

const exp = FUNDING_EXPERIMENT;

describe("hashBucket / variantFor", () => {
  it("matches the reference values (also replicated by scripts/verify.py)", () => {
    // sha256("funding_recommended_v1:<id>")[0..8] % 100
    expect(hashBucket(exp.id, "usr_000466")).toBe(68);
    expect(hashBucket(exp.id, "usr_000048")).toBe(8);
    expect(hashBucket(exp.id, "usr_000871")).toBe(64);
    expect(hashBucket(exp.id, "usr_001197")).toBe(48);
    expect(variantFor(exp, "usr_000466")).toBe("B");
    expect(variantFor(exp, "usr_000048")).toBe("A");
    expect(variantFor(exp, "usr_001197")).toBe("A"); // bucket 48 < 50
  });

  it("is deterministic and stays within [0, 100)", () => {
    for (let i = 0; i < 500; i++) {
      const id = `usr_${String(i).padStart(6, "0")}`;
      const b = hashBucket(exp.id, id);
      expect(b).toBe(hashBucket(exp.id, id));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it("splits the real 1200 users close to 50/50 (588 A / 612 B)", () => {
    const users = JSON.parse(readFileSync("data/users.json", "utf8")) as { id: string }[];
    const counts: Record<string, number> = { A: 0, B: 0 };
    for (const u of users) counts[variantFor(exp, u.id)] += 1;
    expect(counts).toEqual({ A: 588, B: 612 });
    expect(Math.abs(counts.A - counts.B) / users.length).toBeLessThan(0.05);
  });

  it("gives a different partition for a different experiment id (salt)", () => {
    const other = { ...exp, id: "another_experiment" };
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const id = `usr_${String(i).padStart(6, "0")}`;
      if (variantFor(exp, id) !== variantFor(other, id)) differ += 1;
    }
    expect(differ).toBeGreaterThan(50); // ~half should differ; 0 would mean the salt is ignored
  });

  it("walks cumulative weights for uneven allocations", () => {
    const ramp = { ...exp, allocation: [{ variant: "A", weight: 90 }, { variant: "B", weight: 10 }] };
    const users = JSON.parse(readFileSync("data/users.json", "utf8")) as { id: string }[];
    const b = users.filter((u) => variantFor(ramp, u.id) === "B").length;
    expect(b / users.length).toBeGreaterThan(0.06);
    expect(b / users.length).toBeLessThan(0.14);
    // a user in bucket 48 is A under 50/50 and still A under 90/10
    expect(variantFor(ramp, "usr_001197")).toBe("A");
    // a user in bucket 68 flips from B to A when A takes 90
    expect(variantFor(ramp, "usr_000466")).toBe("A");
  });
});
