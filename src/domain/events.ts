import { z } from "zod";
import type { Instant } from "./time";

/**
 * Event catalogue.
 *
 * One append-only log, one strict schema per event name. Each event exists
 * because a specific Growth question needs it (see PLAN.md §8/§10). Unknown
 * event names or unknown props are rejected so schema drift fails loudly.
 *
 * `variant_shown` is what the screen actually rendered — under a paused
 * experiment a B-assigned user sees A, and the event must say A.
 */

export type EventSource = "client" | "webhook" | "system";

export interface EventEnvelope {
  eventId: string;
  name: EventName;
  userId: string;
  /** Provider time for webhook events; server receipt time for client events (client clocks are not trusted). */
  occurredAt: Instant;
  recordedAt: Instant;
  source: EventSource;
  experimentId: string | null;
  variantShown: string | null;
  country: string | null;
  sessionId: string | null;
  schemaVersion: number;
  props: Record<string, unknown>;
}

export const SCHEMA_VERSION = 1;

// ---- props schemas -------------------------------------------------------

const depositProps = z
  .object({
    deposit_id: z.string().min(1),
    method_id: z.string().min(1),
    amount_usd: z.number().positive(),
    currency: z.string().min(1),
  })
  .strict();

export const EVENT_PROPS = {
  // system
  experiment_assigned: z
    .object({
      variant: z.string().min(1),
      allocation_version: z.number().int().positive(),
    })
    .strict(),

  // webhook-derived (emitted by the deposit reducer, once per (deposit, type))
  deposit_received: depositProps,
  deposit_completed: depositProps,
  deposit_failed: depositProps,

  // client — the funding screen (PLAN.md §8.3). Timings are client-measured
  // durations (immune to a wrong clock); timestamps come from the server.
  funding_screen_viewed: z
    .object({
      methods_shown: z.array(z.string().min(1)),
      recommended_method_id: z.string().min(1).nullable(),
      n_visible: z.number().int().nonnegative(),
      client_tz: z.string().min(1).nullable(),
    })
    .strict(),
  funding_method_selected: z
    .object({
      method_id: z.string().min(1),
      position: z.number().int().nonnegative(),
      is_recommended: z.boolean(),
      via: z.enum(["list", "primary", "expanded"]),
      ms_since_view: z.number().nonnegative(),
      n_selected_before: z.number().int().nonnegative(),
    })
    .strict(),
  funding_options_expanded: z.object({ ms_since_view: z.number().nonnegative() }).strict(),
  funding_details_copied: z
    .object({
      method_id: z.string().min(1),
      /** field *name*, never its value */
      field: z.string().min(1),
      ms_since_select: z.number().nonnegative(),
    })
    .strict(),
  funding_screen_left: z
    .object({
      ms_on_screen: z.number().nonnegative(),
      last_step: z.enum(["viewed", "selected", "copied"]),
    })
    .strict(),
} as const;

export type EventName = keyof typeof EVENT_PROPS;
export const EVENT_NAMES = Object.keys(EVENT_PROPS) as EventName[];

/** Names the browser is allowed to send to /api/track. */
export const CLIENT_EVENT_NAMES = [
  "funding_screen_viewed",
  "funding_method_selected",
  "funding_options_expanded",
  "funding_details_copied",
  "funding_screen_left",
] as const satisfies readonly EventName[];
export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

/** What the browser posts. The server adds occurred_at/recorded_at/country and validates props by name. */
export const ClientEventSchema = z
  .object({
    event_id: z.uuid(),
    name: z.enum(CLIENT_EVENT_NAMES),
    user_id: z.string().min(1),
    experiment_id: z.string().min(1),
    variant_shown: z.string().min(1),
    session_id: z.string().min(1).max(64),
    /** Diagnostic only; never used as a timestamp. */
    client_sent_at: z.string().optional(),
    props: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ClientEvent = z.infer<typeof ClientEventSchema>;


export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EVENT_PROPS, name);
}

export type EventProps<N extends EventName> = z.infer<(typeof EVENT_PROPS)[N]>;

/** Validates props for a known event; throws ZodError on drift. */
export function parseEventProps<N extends EventName>(name: N, props: unknown): EventProps<N> {
  return EVENT_PROPS[name].parse(props) as EventProps<N>;
}

// ---- deterministic ids for events the server derives itself --------------
// (client events carry a uuid generated in the browser)

export function assignmentEventId(experimentId: string, userId: string): string {
  return `assign:${experimentId}:${userId}`;
}

export function depositEventId(depositId: string, type: "received" | "completed" | "failed"): string {
  return `dep:${depositId}:${type}`;
}
