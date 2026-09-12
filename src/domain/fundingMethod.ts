export type MethodKind = "local_transfer" | "bank_transfer" | "crypto" | "third_party";

export interface FundingMethod {
  id: string;
  name: string;
  kind: MethodKind;
  currency: string;
  /** ISO country codes, or ["*"] for everywhere. */
  countries: string[];
  settlementHours: number;
  feePct: number;
}

export const EVERYWHERE = "*";

export function isAvailableIn(method: FundingMethod, country: string): boolean {
  return method.countries.includes(EVERYWHERE) || method.countries.includes(country);
}
