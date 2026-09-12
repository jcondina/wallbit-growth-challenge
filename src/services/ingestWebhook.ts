import { ZodError } from "zod";
import { type DepositAnomaly, applyDepositEvent } from "@/domain/deposit";
import { SCHEMA_VERSION, depositEventId } from "@/domain/events";
import { FUNDING_EXPERIMENT } from "@/domain/experiment";
import { type DepositEvent, type DepositEventType, parseProviderEvent } from "@/domain/provider";
import { type Clock, type Instant, minutes, plus } from "@/domain/time";
import { type Db, tx } from "@/infra/db";
import { getAssignment } from "@/infra/repos/assignments";
import { getDeposit, upsertDeposit } from "@/infra/repos/deposits";
import { insertEventIfMissing } from "@/infra/repos/events";
import { getFundingMethod } from "@/infra/repos/fundingMethods";
import { getUser } from "@/infra/repos/users";
import { countRedelivery, insertInboxIfMissing, updateInboxAnomalies } from "@/infra/repos/webhookInbox";
import { verifySignature } from "./webhookSignature";

/**
 * Webhook ingestion (PROVIDER.md: at-least-once, unordered, resends under
 * new ids, occurred_at is the truth).
 *
 *   1. HMAC over the raw bytes            → unauthorized (401)
 *   2. zod contract                        → malformed (400)
 *   3. one transaction:
 *        a. INSERT OR IGNORE inbox(event_id)   → duplicate (200), nothing else runs
 *        b. reduce onto the current deposit state (pure)
 *        c. upsert the deposit if anything changed
 *        d. one domain event per first-time transition (dep:{id}:{type})
 *      → processed (200)
 *
 * Anything thrown after step 2 propagates: the route answers 500 and the
 * provider retries. Business oddities (unknown user/method, negative amount,
 * deposit before signup, future timestamp) are recorded as anomalies on the
 * inbox row and never rejected — a 4xx would make the provider retry forever.
 */

export type IngestionAnomaly =
  | DepositAnomaly
  | "user_unknown"
  | "method_unknown"
  | "non_positive_amount"
  | "deposit_before_signup"
  | "occurred_in_future"
  | "country_mismatch";

export type IngestOutcome =
  | { kind: "unauthorized"; reason: "missing" | "malformed" | "mismatch" }
  | { kind: "malformed"; issues: string[] }
  | { kind: "duplicate"; eventId: string }
  | {
      kind: "processed";
      eventId: string;
      depositId: string;
      changed: boolean;
      transitions: DepositEventType[];
      anomalies: IngestionAnomaly[];
    };

export interface IngestInput {
  rawBody: Buffer;
  headers: {
    signature?: string | null;
    eventId?: string | null;
    eventType?: string | null;
  };
}

export interface IngestDeps {
  db: Db;
  clock: Clock;
  secret: string;
  verifySignature: boolean;
  /** Which experiment's assignment to stamp on the emitted domain events. */
  experimentId?: string;
}

/** How far ahead of the server clock an occurred_at may be before it is flagged. */
export const FUTURE_TOLERANCE = minutes(5);

export function ingestWebhook(deps: IngestDeps, input: IngestInput): IngestOutcome {
  const { db, clock } = deps;
  const experimentId = deps.experimentId ?? FUNDING_EXPERIMENT.id;

  // 1. signature — before touching the body
  const check = verifySignature(deps.secret, input.rawBody, input.headers.signature);
  const signatureOk = check === "ok";
  if (deps.verifySignature && check !== "ok") {
    return { kind: "unauthorized", reason: check };
  }

  // 2. contract
  let event: DepositEvent;
  try {
    event = parseProviderEvent(JSON.parse(input.rawBody.toString("utf8")));
  } catch (error) {
    return { kind: "malformed", issues: describeParseError(error) };
  }

  const receivedAt = clock.now();
  const headerMismatch =
    (input.headers.eventId != null && input.headers.eventId !== event.eventId) ||
    (input.headers.eventType != null && input.headers.eventType !== `deposit.${event.type}`);

  // 3. everything below is atomic
  return tx(db, () => {
    const user = getUser(db, event.userId);
    const anomalies: IngestionAnomaly[] = preReduceAnomalies(event, user, receivedAt, db);

    const firstDelivery = insertInboxIfMissing(db, {
      eventId: event.eventId,
      eventType: `deposit.${event.type}`,
      depositId: event.depositId,
      occurredAt: event.occurredAt,
      receivedAt,
      signatureOk,
      headerMismatch,
      anomalies,
      payload: input.rawBody.toString("utf8"),
    });
    if (!firstDelivery) {
      countRedelivery(db, event.eventId);
      return { kind: "duplicate", eventId: event.eventId };
    }

    const current = getDeposit(db, event.depositId);
    const result = applyDepositEvent(current, event);

    if (result.changed) {
      upsertDeposit(db, {
        ...result.state,
        source: "webhook",
        userKnown: user !== null,
        updatedAt: receivedAt,
      });
    }

    if (result.transitions.length > 0) {
      const assignment = getAssignment(db, experimentId, event.userId);
      for (const type of result.transitions) {
        insertEventIfMissing(db, {
          eventId: depositEventId(event.depositId, type),
          name: `deposit_${type}`,
          userId: event.userId,
          occurredAt: event.occurredAt,
          recordedAt: receivedAt,
          source: "webhook",
          experimentId: assignment?.experimentId ?? null,
          variantShown: assignment?.variant ?? null,
          country: user?.country ?? event.country,
          sessionId: null,
          schemaVersion: SCHEMA_VERSION,
          props: {
            deposit_id: event.depositId,
            method_id: event.methodId,
            amount_usd: event.amountUsd,
            currency: event.currency,
          },
        });
      }
    }

    if (result.anomalies.length > 0) {
      anomalies.push(...result.anomalies);
      updateInboxAnomalies(db, event.eventId, anomalies);
    }

    if (anomalies.length > 0 || headerMismatch) {
      console.warn(
        `[webhook] ${event.eventId} ${event.depositId} anomalies=${anomalies.join(",") || "-"}` +
          (headerMismatch ? " header_mismatch" : ""),
      );
    }

    return {
      kind: "processed",
      eventId: event.eventId,
      depositId: event.depositId,
      changed: result.changed,
      transitions: result.transitions,
      anomalies,
    };
  });
}

function preReduceAnomalies(
  event: DepositEvent,
  user: { createdAt: Instant; country: string } | null,
  now: Instant,
  db: Db,
): IngestionAnomaly[] {
  const anomalies: IngestionAnomaly[] = [];
  if (user === null) anomalies.push("user_unknown");
  else {
    if (event.occurredAt < user.createdAt) anomalies.push("deposit_before_signup");
    if (event.country !== user.country) anomalies.push("country_mismatch");
  }
  if (getFundingMethod(db, event.methodId) === null) anomalies.push("method_unknown");
  if (!(event.amountUsd > 0)) anomalies.push("non_positive_amount");
  if (event.occurredAt > plus(now, FUTURE_TOLERANCE)) anomalies.push("occurred_in_future");
  return anomalies;
}

function describeParseError(error: unknown): string[] {
  if (error instanceof ZodError) {
    return error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.message}`);
  }
  if (error instanceof SyntaxError) return [`body is not valid JSON: ${error.message}`];
  return [String(error)];
}
