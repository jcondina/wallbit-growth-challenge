// Why here: the funnel counts unique users per step among exposed, enrolled
// users, and must not change with delivery order. A small fixture covers
// every signal the page shows; reversing the event order must give the
// same summary.
import { describe, expect, it } from "vitest";
import { type FunnelEvent, computeFunnel } from "@/domain/funnel";
import { type Instant, parseInstant, plus, minutes } from "@/domain/time";

const t0 = parseInstant("2026-08-05T10:00:00Z");
const at = (m: number): Instant => plus(t0, minutes(m));
const variants = ["A", "B"];
const variantByUser = new Map([["u1", "B"], ["u2", "B"], ["u3", "A"], ["u4", "A"], ["u5", "B"]]);

const ev = (name: FunnelEvent["name"], userId: string, m: number, props: Record<string, unknown> = {}, variantShown: string | null = variantByUser.get(userId) ?? null): FunnelEvent => ({
  name,
  userId,
  variantShown,
  occurredAt: at(m),
  source: name.startsWith("deposit_") ? "webhook" : "client",
  props,
});

const events: FunnelEvent[] = [
  // u1 (B): full path, recommended first, expanded, deposited via same method, completed
  ev("funding_screen_viewed", "u1", 0, { n_visible: 1 }),
  ev("funding_method_selected", "u1", 1, { method_id: "local_ar", is_recommended: true, ms_since_view: 4000 }),
  ev("funding_options_expanded", "u1", 2, {}),
  ev("funding_details_copied", "u1", 3, { method_id: "local_ar", ms_since_select: 6000 }),
  ev("funding_screen_left", "u1", 4, { last_step: "copied" }),
  ev("deposit_received", "u1", 60, { method_id: "local_ar" }),
  ev("deposit_completed", "u1", 120, { method_id: "local_ar" }),
  // u2 (B): indecisive (3 methods), copied wire, deposited via crypto (selected ≠ deposited), failed
  ev("funding_screen_viewed", "u2", 0, { n_visible: 1 }),
  ev("funding_method_selected", "u2", 1, { method_id: "local_ar", is_recommended: true, ms_since_view: 2000 }),
  ev("funding_method_selected", "u2", 2, { method_id: "wire_us", is_recommended: false, ms_since_view: 9000 }),
  ev("funding_method_selected", "u2", 3, { method_id: "crypto_usdt", is_recommended: false, ms_since_view: 12000 }),
  ev("funding_details_copied", "u2", 4, { method_id: "crypto_usdt", ms_since_select: 1000 }),
  ev("deposit_received", "u2", 90, { method_id: "wire_us" }),
  ev("deposit_failed", "u2", 200, { method_id: "wire_us" }),
  // u3 (A): looked twice, never selected, left
  ev("funding_screen_viewed", "u3", 0, { n_visible: 7 }),
  ev("funding_screen_left", "u3", 1, { last_step: "viewed" }),
  ev("funding_screen_viewed", "u3", 30, { n_visible: 7 }),
  ev("funding_screen_left", "u3", 31, { last_step: "viewed" }),
  // u4 (A): selected, left without copying
  ev("funding_screen_viewed", "u4", 0, { n_visible: 7 }),
  ev("funding_method_selected", "u4", 2, { method_id: "paypal", is_recommended: false, ms_since_view: 8000 }),
  ev("funding_screen_left", "u4", 3, { last_step: "selected" }),
  // u5 (B): deposited without ever opening the screen (the simulated month)
  ev("deposit_received", "u5", 10, { method_id: "wise" }),
  ev("deposit_completed", "u5", 50, { method_id: "wise" }),
  // u9: not enrolled → ignored entirely
  ev("funding_screen_viewed", "u9", 0, { n_visible: 7 }, "A"),
];

describe("computeFunnel", () => {
  const f = computeFunnel(events, variantByUser, variants);
  const A = f.byVariant[0];
  const B = f.byVariant[1];

  it("counts unique users per step among exposed, enrolled users", () => {
    expect(f.exposedUsers).toBe(4); // u1 u2 u3 u4; u5 unexposed, u9 not enrolled
    expect(B.steps).toEqual({ viewed: 2, selected: 2, copied: 2, received: 2, completed: 1, failed: 1 });
    expect(A.steps).toEqual({ viewed: 2, selected: 1, copied: 0, received: 0, completed: 0, failed: 0 });
  });

  it("derives conversions and the largest drop", () => {
    expect(B.conversion).toEqual({ selected: 1, copied: 1, received: 1, completed: 0.5 });
    expect(B.largestDrop).toEqual({ from: "received", to: "completed", users: 1, rate: 0.5 });
    expect(A.conversion.selected).toBe(0.5);
    expect(A.largestDrop).toEqual({ from: "selected", to: "copied", users: 1, rate: 1 });
  });

  it("measures mechanism and timing", () => {
    expect(B.selectedRecommendedFirst).toBe(2);
    expect(B.expanded).toBe(1);
    expect(B.medianMsToSelect).toBe(3000); // median of 4000 and 2000
    expect(B.medianMsToCopy).toBe(3500); // median of 6000 and 1000
    expect(A.medianMsToSelect).toBe(8000);
  });

  it("builds the per-method table from unique users", () => {
    const row = (id: string) => f.byMethod.find((m) => m.methodId === id);
    expect(row("local_ar")).toEqual({ methodId: "local_ar", selected: 2, copied: 1, received: 1, completed: 1, failed: 0 });
    expect(row("wire_us")).toEqual({ methodId: "wire_us", selected: 1, copied: 0, received: 1, completed: 0, failed: 1 });
    expect(row("crypto_usdt")).toEqual({ methodId: "crypto_usdt", selected: 1, copied: 1, received: 0, completed: 0, failed: 0 });
    expect(row("wise")).toBeUndefined(); // u5 was never exposed
  });

  it("surfaces friction signals", () => {
    expect(f.friction).toEqual({
      indecision: { one: 2, two: 0, threePlus: 1 },
      loopers: 1,
      abandonedAt: { viewed: 1, selected: 1, copied: 1 },
      selectedNotDeposited: 1,
      unexposedDepositors: 1,
    });
  });

  it("is independent of event order", () => {
    expect(computeFunnel([...events].reverse(), variantByUser, variants)).toEqual(f);
  });

  it("groups a user by the variant shown at first exposure", () => {
    const shownA = events.map((e) => (e.userId === "u1" && e.source === "client" ? { ...e, variantShown: "A" } : e));
    const g = computeFunnel(shownA, variantByUser, variants);
    expect(g.byVariant[0].steps.viewed).toBe(3);
    expect(g.byVariant[1].steps.viewed).toBe(1);
  });
});
