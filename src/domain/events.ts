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

  // client events are added with the funding screen (PLAN.md §8.3)
} as const;

export type EventName = keyof typeof EVENT_PROPS;
export const EVENT_NAMES = Object.keys(EVENT_PROPS) as EventName[];

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
