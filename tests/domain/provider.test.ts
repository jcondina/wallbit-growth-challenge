// Why here: the provider contract is the boundary where a malformed or
// ambiguous timestamp would otherwise become a silent wrong number. A real
// scenario event must parse; the failure modes must fail.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProviderEvent } from "@/domain/provider";
import { parseInstant } from "@/domain/time";

const scenario = JSON.parse(readFileSync("simulator/scenario.json", "utf8")) as { events: unknown[] };
const sample = scenario.events[0] as Record<string, unknown>;

describe("parseProviderEvent", () => {
  it("parses the first real scenario event (a `failed`, for dep_100030)", () => {
    const e = parseProviderEvent(sample);
    expect(e).toMatchObject({ eventId: "evt_000060", type: "failed", depositId: "dep_100030", userId: "usr_000657", methodId: "payoneer", amountUsd: 108.84, currency: "USD", country: "MX" });
    expect(e.occurredAt).toBe(parseInstant("2026-08-01T15:44:12Z"));
  });

  it("parses every event in the scenario", () => {
    expect(() => scenario.events.forEach(parseProviderEvent)).not.toThrow();
  });

  it("rejects a naive occurred_at", () => {
    expect(() => parseProviderEvent({ ...sample, occurred_at: "2026-08-01T15:44:12" })).toThrow(/unambiguous instant/);
  });

  it("rejects unknown types and missing ids", () => {
    expect(() => parseProviderEvent({ ...sample, type: "deposit.reversed" })).toThrow();
    expect(() => parseProviderEvent({ ...sample, data: { ...(sample.data as object), deposit_id: "" } })).toThrow();
  });

  it("strips unknown top-level fields instead of rejecting them", () => {
    expect(() => parseProviderEvent({ ...sample, provider_version: "2.0" })).not.toThrow();
  });

  it("does not reject business-value oddities (those become anomalies at ingestion)", () => {
    expect(parseProviderEvent({ ...sample, data: { ...(sample.data as object), amount_usd: -5, method_id: "unknown_rail" } })).toMatchObject({ amountUsd: -5, methodId: "unknown_rail" });
  });
});
