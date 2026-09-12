// Why here: variant B is only meaningful if every country gets a valid
// recommendation. UY and ES have no local rail in the catalogue, so the
// fallback chain is exercised by real data, not hypotheticals.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type FundingMethod, isAvailableIn } from "@/domain/fundingMethod";
import { eligibleMethodsFor, otherMethodsFor, recommendedMethodFor, NoMethodAvailable } from "@/domain/recommendation";

const catalogue = (JSON.parse(readFileSync("data/funding_methods.json", "utf8")) as Array<{
  id: string; name: string; kind: FundingMethod["kind"]; currency: string; countries: string[]; settlement_hours: number; fee_pct: number;
}>).map((m) => ({ id: m.id, name: m.name, kind: m.kind, currency: m.currency, countries: m.countries, settlementHours: m.settlement_hours, feePct: m.fee_pct }));

const countries = [...new Set((JSON.parse(readFileSync("data/users.json", "utf8")) as { country: string }[]).map((u) => u.country))].sort();

describe("recommendedMethodFor", () => {
  it("recommends the local rail where one exists", () => {
    for (const [country, id] of [["AR", "local_ar"], ["MX", "local_mx"], ["CO", "local_co"], ["BR", "local_br"], ["PE", "local_pe"], ["BO", "local_bo"], ["GT", "local_gt"], ["DO", "local_do"]]) {
      expect(recommendedMethodFor(country, catalogue).id).toBe(id);
    }
  });

  it("falls back to the regional bank transfer (ES → sepa_eu) and then to wire_us (UY)", () => {
    expect(recommendedMethodFor("ES", catalogue).id).toBe("sepa_eu");
    expect(recommendedMethodFor("UY", catalogue).id).toBe("wire_us");
    expect(recommendedMethodFor("US", catalogue).id).toBe("ach_us");
    expect(recommendedMethodFor("JP", catalogue).id).toBe("wire_us"); // no rail at all → global fallback
  });

  it("returns an eligible method for every country in users.json", () => {
    expect(countries).toEqual(["AR", "BO", "BR", "CO", "DO", "ES", "GT", "MX", "PE", "UY"]);
    for (const c of countries) {
      const rec = recommendedMethodFor(c, catalogue);
      expect(isAvailableIn(rec, c)).toBe(true);
      expect(catalogue.some((m) => m.id === rec.id)).toBe(true);
    }
  });

  it("throws when the catalogue has nothing for the country", () => {
    const localOnly = catalogue.filter((m) => m.kind === "local_transfer");
    expect(() => recommendedMethodFor("UY", localOnly)).toThrow(NoMethodAvailable);
  });
});

describe("eligible / other methods", () => {
  it("AR sees its local rail plus the six global methods, in catalogue order", () => {
    const ids = eligibleMethodsFor("AR", catalogue).map((m) => m.id);
    expect(ids).toEqual(["local_ar", "wire_us", "crypto_usdt", "crypto_usdc", "paypal", "wise", "payoneer"]);
  });

  it("UY sees only the six global methods", () => {
    expect(eligibleMethodsFor("UY", catalogue).map((m) => m.id)).toEqual(["wire_us", "crypto_usdt", "crypto_usdc", "paypal", "wise", "payoneer"]);
  });

  it("never lists the recommended method among the others", () => {
    for (const c of countries) {
      const rec = recommendedMethodFor(c, catalogue);
      const others = otherMethodsFor(c, catalogue, rec);
      expect(others.map((m) => m.id)).not.toContain(rec.id);
      expect(others.length).toBe(eligibleMethodsFor(c, catalogue).length - 1);
    }
  });
});
