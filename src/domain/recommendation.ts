import { type FundingMethod, isAvailableIn } from "./fundingMethod";

/**
 * Variant B's recommendation rule — the brief's hypothesis verbatim:
 * "un único método recomendado según su país".
 *
 *   1. The country's local transfer rail (local_ar, local_mx, …).
 *   2. Otherwise a regional bank transfer that lists the country explicitly
 *      (sepa_eu for ES; ach_us for US). Wildcard methods do not count here.
 *   3. Otherwise the global fallback: wire_us — available everywhere, 0 % fee,
 *      and what UY users historically used most.
 *
 * Settlement caveat, stated in ENTREGA: for PE/BO/GT/DO the local rail is as
 * slow as a wire (36–48 h). The rule still recommends local because that is
 * the hypothesis under test; the by-country cut shows whether it hurt.
 */

export const GLOBAL_FALLBACK_METHOD_ID = "wire_us";

export class NoMethodAvailable extends Error {
  constructor(country: string) {
    super(`no funding method available for country ${country}`);
    this.name = "NoMethodAvailable";
  }
}

/** Methods a user from `country` can use, in catalogue order. */
export function eligibleMethodsFor(country: string, methods: FundingMethod[]): FundingMethod[] {
  return methods.filter((m) => isAvailableIn(m, country));
}

export function recommendedMethodFor(country: string, methods: FundingMethod[]): FundingMethod {
  const eligible = eligibleMethodsFor(country, methods);
  if (eligible.length === 0) throw new NoMethodAvailable(country);

  const local = eligible.find((m) => m.kind === "local_transfer");
  if (local) return local;

  const regionalBank = eligible.find(
    (m) => m.kind === "bank_transfer" && !m.countries.includes("*"),
  );
  if (regionalBank) return regionalBank;

  return eligible.find((m) => m.id === GLOBAL_FALLBACK_METHOD_ID) ?? eligible[0];
}

/** What variant B hides behind "ver otras opciones": everything eligible except the recommendation. */
export function otherMethodsFor(
  country: string,
  methods: FundingMethod[],
  recommended: FundingMethod,
): FundingMethod[] {
  return eligibleMethodsFor(country, methods).filter((m) => m.id !== recommended.id);
}
