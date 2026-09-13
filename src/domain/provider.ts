import { z } from "zod";
import { type Instant, parseInstant } from "./time";

/**
 * The payments provider's webhook contract (simulator/PROVIDER.md).
 *
 * Structure is validated strictly enough to be safe (ids present, a known
 * type, an unambiguous occurred_at). Business values (amount sign, method
 * existence) are NOT rejected here: a 4xx makes the provider retry forever,
 * so those become anomalies flagged at ingestion instead.
 *
 * Unknown top-level fields are stripped, not rejected — providers add
 * fields without notice.
 */

export const DEPOSIT_EVENT_TYPES = ["received", "completed", "failed"] as const;
export type DepositEventType = (typeof DEPOSIT_EVENT_TYPES)[number];

// Identifiers are short (evt_000123, dep_100042); the caps only stop abuse.
const id = z.string().min(1).max(200);
const code = z.string().min(1).max(16);

export const ProviderEventSchema = z.object({
  event_id: id,
  type: z.enum(["deposit.received", "deposit.completed", "deposit.failed"]),
  occurred_at: z.string().transform((raw, ctx) => {
    try {
      return parseInstant(raw);
    } catch {
      ctx.addIssue({ code: "custom", message: `occurred_at is not an unambiguous instant: ${raw}` });
      return z.NEVER;
    }
  }),
  data: z.object({
    deposit_id: id,
    user_id: id,
    method_id: id,
    amount_usd: z.number().finite(),
    currency: code,
    country: code,
  }),
});

/** A parsed, typed provider event — what the reducer consumes. */
export interface DepositEvent {
  eventId: string;
  type: DepositEventType;
  occurredAt: Instant;
  depositId: string;
  userId: string;
  methodId: string;
  amountUsd: number;
  currency: string;
  country: string;
}

export function toDepositEvent(p: z.infer<typeof ProviderEventSchema>): DepositEvent {
  return {
    eventId: p.event_id,
    type: p.type.slice("deposit.".length) as DepositEventType,
    occurredAt: p.occurred_at,
    depositId: p.data.deposit_id,
    userId: p.data.user_id,
    methodId: p.data.method_id,
    amountUsd: p.data.amount_usd,
    currency: p.data.currency,
    country: p.data.country,
  };
}

/** Parses raw JSON (already decoded) into a DepositEvent; throws ZodError on contract violations. */
export function parseProviderEvent(json: unknown): DepositEvent {
  return toDepositEvent(ProviderEventSchema.parse(json));
}
