// Why here: this is the contract with the provider. Each case is a delivery
// pattern PROVIDER.md promises will happen (duplicate id, resend under a new
// id, unordered) or a failure mode that must not turn into a retry storm
// (bad signature, malformed body, unknown user). The last block pushes the
// whole scenario through the real pipeline on an in-memory database and
// must match what the pure-domain replay already proved.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixedClock, parseInstant } from "@/domain/time";
import { type Db, openDb, queryRow } from "@/infra/db";
import { getDeposit } from "@/infra/repos/deposits";
import { countEventsByName, listEventsByUser } from "@/infra/repos/events";
import { getInboxEntry, inboxStats } from "@/infra/repos/webhookInbox";
import { type IngestDeps, ingestWebhook } from "@/services/ingestWebhook";
import { seedDatabase } from "@/services/seed";
import { signBody } from "@/services/webhookSignature";

const SECRET = "whsec_sandbox_wallbit";
const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));

function fresh(): { db: Db; deps: IngestDeps } {
  const db = openDb(":memory:");
  seedDatabase(db, { clock });
  return { db, deps: { db, clock, secret: SECRET, verifySignature: true } };
}

interface Payload {
  event_id: string;
  type: string;
  occurred_at: string;
  data: { deposit_id: string; user_id: string; method_id: string; amount_usd: number; currency: string; country: string };
}

// usr_000871 signed up 2026-08-02T08:50:12Z (AR, variant B)
const base: Payload = {
  event_id: "evt_t_001",
  type: "deposit.received",
  occurred_at: "2026-08-03T10:00:00Z",
  data: { deposit_id: "dep_t_1", user_id: "usr_000871", method_id: "local_ar", amount_usd: 250, currency: "ARS", country: "AR" },
};

function deliver(deps: IngestDeps, payload: Payload, opts: { sign?: boolean; headers?: Partial<Record<"eventId" | "eventType" | "signature", string | null>> } = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const headers = {
    eventId: payload.event_id,
    eventType: payload.type,
    signature: opts.sign === false ? null : signBody(deps.secret, rawBody),
    ...opts.headers,
  };
  return ingestWebhook(deps, { rawBody, headers });
}

const count = (db: Db, table: string) => queryRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table}`).n;
const webhookDeposits = (db: Db) => queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM deposits WHERE source = 'webhook'").n;

describe("ingestWebhook — happy path", () => {
  it("stores the delivery, creates the deposit and emits one domain event", () => {
    const { db, deps } = fresh();
    const out = deliver(deps, base);
    expect(out).toMatchObject({ kind: "processed", depositId: "dep_t_1", changed: true, transitions: ["received"], anomalies: [] });

    const inbox = getInboxEntry(db, "evt_t_001");
    expect(inbox).toMatchObject({ eventType: "deposit.received", depositId: "dep_t_1", signatureOk: true, headerMismatch: false, anomalies: [] });
    expect(inbox?.occurredAt).toBe(parseInstant("2026-08-03T10:00:00Z"));
    expect(inbox?.receivedAt).toBe(clock.now());

    expect(getDeposit(db, "dep_t_1")).toMatchObject({ status: "received", source: "webhook", userKnown: true, initiatedAt: parseInstant("2026-08-03T10:00:00Z") });

    const events = listEventsByUser(db, "usr_000871").filter((e) => e.name.startsWith("deposit_"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventId: "dep:dep_t_1:received", source: "webhook", experimentId: "funding_recommended_v1", variantShown: "B", country: "AR" });
  });

  it("completes the deposit on a later `completed`", () => {
    const { db, deps } = fresh();
    deliver(deps, base);
    const out = deliver(deps, { ...base, event_id: "evt_t_002", type: "deposit.completed", occurred_at: "2026-08-04T06:00:00Z", data: { ...base.data, amount_usd: 251.2 } });
    expect(out).toMatchObject({ kind: "processed", changed: true, transitions: ["completed"] });
    expect(getDeposit(db, "dep_t_1")).toMatchObject({ status: "completed", amountUsd: 251.2, completedAt: parseInstant("2026-08-04T06:00:00Z") });
    expect(countEventsByName(db)).toMatchObject({ deposit_received: 1, deposit_completed: 1 });
  });
});

describe("ingestWebhook — at-least-once delivery", () => {
  it("a redelivery of the same event_id is a duplicate and writes nothing", () => {
    const { db, deps } = fresh();
    deliver(deps, base);
    const before = [count(db, "webhook_inbox"), webhookDeposits(db), count(db, "events")];
    expect(deliver(deps, base)).toEqual({ kind: "duplicate", eventId: "evt_t_001" });
    expect([count(db, "webhook_inbox"), webhookDeposits(db), count(db, "events")]).toEqual(before);
  });

  it("a resend under a new event_id is stored in the inbox but changes no state and emits no event", () => {
    const { db, deps } = fresh();
    deliver(deps, base);
    const out = deliver(deps, { ...base, event_id: "evt_t_resend" });
    expect(out).toMatchObject({ kind: "processed", changed: false, transitions: [] });
    expect(count(db, "webhook_inbox")).toBe(2);
    expect(webhookDeposits(db)).toBe(1);
    expect(countEventsByName(db).deposit_received).toBe(1);
  });

  it("a `completed` that arrives before its `received` still ends completed with both instants", () => {
    const { db, deps } = fresh();
    deliver(deps, { ...base, event_id: "evt_c", type: "deposit.completed", occurred_at: "2026-08-04T06:00:00Z" });
    deliver(deps, { ...base, event_id: "evt_r" });
    expect(getDeposit(db, "dep_t_1")).toMatchObject({
      status: "completed",
      initiatedAt: parseInstant("2026-08-03T10:00:00Z"),
      completedAt: parseInstant("2026-08-04T06:00:00Z"),
    });
  });
});

describe("ingestWebhook — rejections (nothing is stored)", () => {
  it("bad signature → unauthorized", () => {
    const { db, deps } = fresh();
    expect(deliver(deps, base, { headers: { signature: "sha256=" + "0".repeat(64) } })).toEqual({ kind: "unauthorized", reason: "mismatch" });
    expect(deliver(deps, base, { sign: false })).toEqual({ kind: "unauthorized", reason: "missing" });
    expect(deliver(deps, base, { headers: { signature: "nope" } })).toEqual({ kind: "unauthorized", reason: "malformed" });
    expect(count(db, "webhook_inbox")).toBe(0);
  });

  it("unsigned deliveries are accepted (and recorded as unsigned) only when verification is off", () => {
    const { db, deps } = fresh();
    const out = deliver({ ...deps, verifySignature: false }, base, { sign: false });
    expect(out.kind).toBe("processed");
    expect(getInboxEntry(db, "evt_t_001")?.signatureOk).toBe(false);
    expect(inboxStats(db).unsigned).toBe(1);
  });

  it("malformed body → malformed, with the reason", () => {
    const { db, deps } = fresh();
    const raw = Buffer.from("{not json", "utf8");
    expect(ingestWebhook(deps, { rawBody: raw, headers: { signature: signBody(SECRET, raw) } })).toMatchObject({ kind: "malformed", issues: [expect.stringContaining("not valid JSON")] });
    expect(deliver(deps, { ...base, occurred_at: "2026-08-03T10:00:00" })).toMatchObject({ kind: "malformed", issues: [expect.stringContaining("occurred_at")] });
    expect(deliver(deps, { ...base, type: "deposit.reversed" })).toMatchObject({ kind: "malformed" });
    expect(count(db, "webhook_inbox")).toBe(0);
  });
});

describe("ingestWebhook — anomalies are recorded, never rejected", () => {
  it("unknown user: stored, flagged, deposit marked user_known = false", () => {
    const { db, deps } = fresh();
    const out = deliver(deps, { ...base, data: { ...base.data, user_id: "usr_ghost" } });
    expect(out).toMatchObject({ kind: "processed", anomalies: ["user_unknown"] });
    expect(getDeposit(db, "dep_t_1")?.userKnown).toBe(false);
    expect(getInboxEntry(db, "evt_t_001")?.anomalies).toEqual(["user_unknown"]);
  });

  it("deposit before signup, country mismatch, unknown method, non-positive amount, future timestamp", () => {
    const { deps } = fresh();
    const out = deliver(deps, {
      ...base,
      occurred_at: "2026-08-01T00:00:00Z", // usr_000871 signed up on the 2nd
      data: { ...base.data, country: "MX", method_id: "rail_x", amount_usd: 0 },
    });
    expect(out).toMatchObject({ kind: "processed", anomalies: ["deposit_before_signup", "country_mismatch", "method_unknown", "non_positive_amount"] });

    const future = deliver(deps, { ...base, event_id: "evt_f", data: { ...base.data, deposit_id: "dep_f" }, occurred_at: "2026-09-12T12:10:00Z" });
    expect(future).toMatchObject({ anomalies: ["occurred_in_future"] });
  });

  it("header/body disagreement: body wins, mismatch is flagged", () => {
    const { db, deps } = fresh();
    const out = deliver(deps, base, { headers: { eventId: "evt_other" } });
    expect(out).toMatchObject({ kind: "processed", eventId: "evt_t_001" });
    expect(getInboxEntry(db, "evt_t_001")?.headerMismatch).toBe(true);
    expect(inboxStats(db).headerMismatches).toBe(1);
  });

  it("user/method drift between events of one deposit is flagged and not applied", () => {
    const { db, deps } = fresh();
    deliver(deps, base);
    const out = deliver(deps, { ...base, event_id: "evt_2", type: "deposit.completed", data: { ...base.data, user_id: "usr_000048", method_id: "wire_us" } });
    expect(out).toMatchObject({ anomalies: ["user_mismatch", "method_mismatch"] });
    expect(getDeposit(db, "dep_t_1")).toMatchObject({ userId: "usr_000871", methodId: "local_ar", status: "completed" });
    expect(getInboxEntry(db, "evt_2")?.anomalies).toEqual(["user_mismatch", "method_mismatch"]);
  });
});

describe("ingestWebhook — the whole scenario, twice", () => {
  const scenario = JSON.parse(readFileSync("simulator/scenario.json", "utf8")) as { events: Payload[] };

  function replayAll(deps: IngestDeps) {
    const outcomes = { processed: 0, noop: 0, duplicate: 0, other: 0 };
    for (const e of scenario.events) {
      const out = deliver(deps, e);
      if (out.kind === "duplicate") outcomes.duplicate += 1;
      else if (out.kind === "processed") outcomes[out.changed ? "processed" : "noop"] += 1;
      else outcomes.other += 1;
    }
    return outcomes;
  }

  it("matches the reference numbers and is unchanged by a second full replay", () => {
    const { db, deps } = fresh();
    const first = replayAll(deps);
    expect(first).toEqual({ processed: 598, noop: 8, duplicate: 42, other: 0 });

    const snapshot = () => ({
      inbox: inboxStats(db),
      deposits: queryRow<{ n: number }>(db, "SELECT COUNT(*) AS n FROM deposits WHERE source = 'webhook'").n,
      byStatus: Object.fromEntries((db.prepare("SELECT status, COUNT(*) AS n FROM deposits WHERE source = 'webhook' GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n])),
      events: countEventsByName(db),
    });
    const after1 = snapshot();
    expect(after1.inbox).toMatchObject({ deliveries: 648, uniqueEvents: 606, resends: 8, withAnomalies: 0, headerMismatches: 0, unsigned: 0 });
    expect(after1.inbox.lastOccurredAt).toBe(parseInstant("2026-08-30T15:27:00Z"));
    expect(after1.deposits).toBe(299);
    expect(after1.byStatus).toEqual({ completed: 254, failed: 45 });
    expect(after1.events).toMatchObject({ deposit_received: 299, deposit_completed: 254, deposit_failed: 45, experiment_assigned: 600 });

    const second = replayAll(deps);
    expect(second).toEqual({ processed: 0, noop: 0, duplicate: 648, other: 0 });
    const after2 = snapshot();
    expect(after2.inbox.deliveries).toBe(1296); // the only thing a full redelivery may change
    expect({ ...after2, inbox: { ...after2.inbox, deliveries: 0 } }).toEqual({ ...after1, inbox: { ...after1.inbox, deliveries: 0 } });
  });
});
