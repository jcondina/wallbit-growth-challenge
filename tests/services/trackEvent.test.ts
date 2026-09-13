// Why here: /api/track is the only write path the browser has. It must
// dedupe, stamp server time, keep country from the user row, and reject
// anything outside the catalogue — and it must never trust the client clock.
import { describe, expect, it } from "vitest";
import { fixedClock, parseInstant } from "@/domain/time";
import { openDb } from "@/infra/db";
import { listEventsByUser } from "@/infra/repos/events";
import { seedDatabase } from "@/services/seed";
import { trackEvent } from "@/services/trackEvent";

const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));
const UUID = "6f1c2a4e-9b3d-4c8e-a1f2-3b4c5d6e7f80";

function fresh() {
  const db = openDb(":memory:");
  seedDatabase(db, { clock });
  return { db, deps: { db, clock } };
}

const viewed = {
  event_id: UUID,
  name: "funding_screen_viewed",
  user_id: "usr_000871", // AR, assigned B
  experiment_id: "funding_recommended_v1",
  variant_shown: "B",
  session_id: "sess-1",
  client_sent_at: "1999-01-01T00:00:00Z", // wrong on purpose; must be ignored as a timestamp
  props: { methods_shown: ["local_ar"], recommended_method_id: "local_ar", n_visible: 1, client_tz: "America/Buenos_Aires" },
};

describe("trackEvent", () => {
  it("stores with server time, the user's country and the session", () => {
    const { db, deps } = fresh();
    expect(trackEvent(deps, viewed)).toEqual({ kind: "stored", eventId: UUID, variantMismatch: false });
    const [e] = listEventsByUser(db, "usr_000871").filter((x) => x.source === "client");
    expect(e).toMatchObject({ name: "funding_screen_viewed", variantShown: "B", country: "AR", sessionId: "sess-1", source: "client" });
    expect(e.occurredAt).toBe(clock.now());
    expect(e.recordedAt).toBe(clock.now());
  });

  it("is idempotent by event_id", () => {
    const { db, deps } = fresh();
    trackEvent(deps, viewed);
    expect(trackEvent(deps, viewed)).toEqual({ kind: "duplicate", eventId: UUID });
    expect(listEventsByUser(db, "usr_000871").filter((x) => x.source === "client")).toHaveLength(1);
  });

  it("rejects unknown names, extra props and malformed envelopes", () => {
    const { deps } = fresh();
    expect(trackEvent(deps, { ...viewed, name: "deposit_completed" }).kind).toBe("invalid");
    expect(trackEvent(deps, { ...viewed, props: { ...viewed.props, secret: 1 } }).kind).toBe("invalid");
    expect(trackEvent(deps, { ...viewed, event_id: "nope" }).kind).toBe("invalid");
    expect(trackEvent(deps, "garbage").kind).toBe("invalid");
  });

  it("rejects unknown users", () => {
    const { deps } = fresh();
    expect(trackEvent(deps, { ...viewed, user_id: "usr_ghost" })).toEqual({ kind: "unknown_user", userId: "usr_ghost" });
  });

  it("stores but flags a variant that disagrees with the assignment", () => {
    const { db, deps } = fresh();
    const out = trackEvent(deps, { ...viewed, variant_shown: "A" });
    expect(out).toEqual({ kind: "stored", eventId: UUID, variantMismatch: true });
    expect(listEventsByUser(db, "usr_000871").find((x) => x.eventId === UUID)?.variantShown).toBe("A");
  });
});
