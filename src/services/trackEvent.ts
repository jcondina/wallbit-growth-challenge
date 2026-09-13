import { ZodError } from "zod";
import { type ClientEvent, ClientEventSchema, SCHEMA_VERSION, parseEventProps } from "@/domain/events";
import type { Clock } from "@/domain/time";
import type { Db } from "@/infra/db";
import { getAssignment } from "@/infra/repos/assignments";
import { insertEventIfMissing } from "@/infra/repos/events";
import { getUser } from "@/infra/repos/users";

/**
 * Stores one client-side event.
 *
 *   - Envelope and props are validated against the catalogue; an unknown
 *     name or an extra prop is rejected, so schema drift fails loudly.
 *   - occurred_at = recorded_at = server clock. Client clocks are never used
 *     as timestamps; intra-session timing travels as durations in props.
 *   - INSERT OR IGNORE by event_id: React StrictMode double effects, retries
 *     and back/forward re-mounts cannot double count.
 *   - variant_shown is what the screen rendered; if it disagrees with the
 *     stored assignment it is still recorded (the screen is the truth of
 *     what the user saw) and reported so the mismatch is visible.
 */

export type TrackOutcome =
  | { kind: "invalid"; issues: string[] }
  | { kind: "unknown_user"; userId: string }
  | { kind: "stored"; eventId: string; variantMismatch: boolean }
  | { kind: "duplicate"; eventId: string };

export function trackEvent(deps: { db: Db; clock: Clock }, body: unknown): TrackOutcome {
  let event: ClientEvent;
  let props: Record<string, unknown>;
  try {
    event = ClientEventSchema.parse(body);
    props = parseEventProps(event.name, event.props);
  } catch (error) {
    return { kind: "invalid", issues: describe(error) };
  }

  const { db } = deps;
  const user = getUser(db, event.user_id);
  if (!user) return { kind: "unknown_user", userId: event.user_id };

  const assignment = getAssignment(db, event.experiment_id, event.user_id);
  const variantMismatch = assignment !== null && assignment.variant !== event.variant_shown;
  if (variantMismatch) {
    console.warn(`[track] ${event.name} for ${event.user_id}: shown ${event.variant_shown}, assigned ${assignment?.variant}`);
  }

  const now = deps.clock.now();
  const stored = insertEventIfMissing(db, {
    eventId: event.event_id,
    name: event.name,
    userId: event.user_id,
    occurredAt: now,
    recordedAt: now,
    source: "client",
    experimentId: event.experiment_id,
    variantShown: event.variant_shown,
    country: user.country,
    sessionId: event.session_id,
    schemaVersion: SCHEMA_VERSION,
    props,
  });
  return stored ? { kind: "stored", eventId: event.event_id, variantMismatch } : { kind: "duplicate", eventId: event.event_id };
}

function describe(error: unknown): string[] {
  if (error instanceof ZodError) return error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`);
  return [String(error)];
}
