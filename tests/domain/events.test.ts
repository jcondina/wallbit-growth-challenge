// Why here: the catalogue is the contract between the screen, /api/track
// and every read model. A fixture per event proves the shapes; the "extra
// prop" and "unknown name" cases prove drift cannot slip in silently.
import { describe, expect, it } from "vitest";
import { CLIENT_EVENT_NAMES, ClientEventSchema, EVENT_NAMES, isEventName, parseEventProps } from "@/domain/events";

const fixtures = {
  experiment_assigned: { variant: "B", allocation_version: 1 },
  deposit_received: { deposit_id: "dep_1", method_id: "local_ar", amount_usd: 100, currency: "ARS" },
  deposit_completed: { deposit_id: "dep_1", method_id: "local_ar", amount_usd: 100, currency: "ARS" },
  deposit_failed: { deposit_id: "dep_1", method_id: "local_ar", amount_usd: 100, currency: "ARS" },
  funding_screen_viewed: { methods_shown: ["local_ar", "wire_us"], recommended_method_id: "local_ar", n_visible: 1, client_tz: "America/Buenos_Aires" },
  funding_method_selected: { method_id: "local_ar", position: 0, is_recommended: true, via: "primary", ms_since_view: 4961, n_selected_before: 0 },
  funding_options_expanded: { ms_since_view: 15381 },
  funding_details_copied: { method_id: "local_ar", field: "cbu", ms_since_select: 5650 },
  funding_screen_left: { ms_on_screen: 41115, last_step: "copied" },
} as const;

describe("event catalogue", () => {
  it("has a fixture for every event and every fixture validates", () => {
    expect(Object.keys(fixtures).sort()).toEqual([...EVENT_NAMES].sort());
    for (const [name, props] of Object.entries(fixtures)) {
      expect(() => parseEventProps(name as keyof typeof fixtures, props)).not.toThrow();
    }
  });

  it("rejects an extra prop (strict schemas) and a missing one", () => {
    expect(() => parseEventProps("funding_details_copied", { ...fixtures.funding_details_copied, value: "0000" })).toThrow();
    expect(() => parseEventProps("funding_screen_left", { ms_on_screen: 1 })).toThrow();
  });

  it("rejects wrong shapes: negative durations, unknown via, non-boolean flags", () => {
    expect(() => parseEventProps("funding_options_expanded", { ms_since_view: -1 })).toThrow();
    expect(() => parseEventProps("funding_method_selected", { ...fixtures.funding_method_selected, via: "magic" })).toThrow();
    expect(() => parseEventProps("funding_method_selected", { ...fixtures.funding_method_selected, is_recommended: "yes" })).toThrow();
  });

  it("knows which names the browser may send", () => {
    expect(CLIENT_EVENT_NAMES).toEqual(["funding_screen_viewed", "funding_method_selected", "funding_options_expanded", "funding_details_copied", "funding_screen_left"]);
    expect(isEventName("deposit_completed")).toBe(true);
    expect(isEventName("page_scrolled")).toBe(false);
  });

  it("validates the client envelope: uuid event_id, known name, no extras", () => {
    const ok = { event_id: "6f1c2a4e-9b3d-4c8e-a1f2-3b4c5d6e7f80", name: "funding_screen_left", user_id: "usr_1", experiment_id: "exp", variant_shown: "A", session_id: "s", props: {} };
    expect(() => ClientEventSchema.parse(ok)).not.toThrow();
    expect(() => ClientEventSchema.parse({ ...ok, event_id: "not-a-uuid" })).toThrow();
    expect(() => ClientEventSchema.parse({ ...ok, name: "deposit_completed" })).toThrow(); // server-only
    expect(() => ClientEventSchema.parse({ ...ok, occurred_at: "2026-08-01T00:00:00Z" })).toThrow(); // clients don't set time
  });
});
