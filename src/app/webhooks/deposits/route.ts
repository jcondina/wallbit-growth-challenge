import { systemClock } from "@/domain/time";
import { webhookConfig } from "@/infra/config";
import { getDb } from "@/infra/db";
import { ingestWebhook } from "@/services/ingestWebhook";

// POST /webhooks/deposits — the simulator's default path (PROVIDER.md).
// The body is read as raw bytes so the HMAC is computed over exactly what
// the provider signed; JSON parsing happens inside the service, after.
export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const config = webhookConfig();

  try {
    const outcome = ingestWebhook(
      { db: getDb(), clock: systemClock, secret: config.secret, verifySignature: config.verifySignature },
      {
        rawBody,
        headers: {
          signature: request.headers.get("x-wallbit-signature"),
          eventId: request.headers.get("x-wallbit-event-id"),
          eventType: request.headers.get("x-wallbit-event-type"),
        },
      },
    );

    switch (outcome.kind) {
      case "too_large":
        return Response.json({ error: "body too large", bytes: outcome.bytes }, { status: 413 });
      case "unauthorized":
        return Response.json({ error: "invalid signature", reason: outcome.reason }, { status: 401 });
      case "malformed":
        return Response.json({ error: "malformed event", issues: outcome.issues }, { status: 400 });
      case "duplicate":
        return Response.json({ status: "duplicate", event_id: outcome.eventId });
      case "processed":
        return Response.json({
          status: outcome.changed ? "processed" : "noop",
          event_id: outcome.eventId,
          deposit_id: outcome.depositId,
          transitions: outcome.transitions,
          anomalies: outcome.anomalies,
        });
    }
  } catch (error) {
    // Storage failure: answer 5xx so the provider retries this delivery.
    console.error("[webhook] ingestion failed", error);
    return Response.json({ error: "ingestion failed" }, { status: 500 });
  }
}
