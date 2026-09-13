import { systemClock } from "@/domain/time";
import { getDb } from "@/infra/db";
import { trackEvent } from "@/services/trackEvent";

// POST /api/track — one client-side event per request, sent fire-and-forget
// by lib/analytics.ts (sendBeacon, so the content type may be text/plain).
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return Response.json({ error: "body too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }

  const outcome = trackEvent({ db: getDb(), clock: systemClock }, body);
  switch (outcome.kind) {
    case "invalid":
      return Response.json({ error: "invalid event", issues: outcome.issues }, { status: 400 });
    case "unknown_user":
      return Response.json({ error: "unknown user", user_id: outcome.userId }, { status: 404 });
    case "duplicate":
      return Response.json({ status: "duplicate", event_id: outcome.eventId });
    case "stored":
      return Response.json({ status: "stored", event_id: outcome.eventId, variant_mismatch: outcome.variantMismatch });
  }
}
