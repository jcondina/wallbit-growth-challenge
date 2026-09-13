// Why here: "same inputs, same outputs" is the property that makes the
// result defensible. Two independent pipelines must agree byte for byte,
// and the provider's delivery order (which it does not guarantee) must not
// leak into any number on either dashboard.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixedClock, parseInstant } from "@/domain/time";
import { type Db, openDb } from "@/infra/db";
import { experimentResults } from "@/services/experimentResults";
import { funnelResults } from "@/services/funnelResults";
import { ingestWebhook } from "@/services/ingestWebhook";
import { seedDatabase } from "@/services/seed";
import { signBody } from "@/services/webhookSignature";

const clock = fixedClock(parseInstant("2026-09-12T12:00:00Z"));
const SECRET = "whsec_sandbox_wallbit";
type Delivery = { event_id: string; type: string };
const scenario = (JSON.parse(readFileSync("simulator/scenario.json", "utf8")) as { events: Delivery[] }).events;

/** Deterministic PRNG so a "random" order is reproducible when a test fails. */
function shuffled<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pipeline(deliveries: Delivery[]): Db {
  const db = openDb(":memory:");
  seedDatabase(db, { clock });
  for (const e of deliveries) {
    const rawBody = Buffer.from(JSON.stringify(e), "utf8");
    ingestWebhook({ db, clock, secret: SECRET, verifySignature: true }, { rawBody, headers: { signature: signBody(SECRET, rawBody), eventId: e.event_id, eventType: e.type } });
  }
  return db;
}

const snapshot = (db: Db) => ({
  results: JSON.stringify(experimentResults(db, { clock })),
  // `recent` is ordered by insertion (rowid) as a tiebreak, which a shuffle legitimately changes.
  funnel: JSON.stringify({ ...funnelResults(db), recent: undefined }),
});

describe("determinism", () => {
  const reference = snapshot(pipeline(scenario));

  it("two independent runs of the same input agree byte for byte", () => {
    expect(snapshot(pipeline(scenario))).toEqual(reference);
  });

  it("delivery order does not change any result (three seeded shuffles + reverse)", () => {
    for (const order of [shuffled(scenario, 1), shuffled(scenario, 42), shuffled(scenario, 2026), [...scenario].reverse()]) {
      expect(snapshot(pipeline(order))).toEqual(reference);
    }
  });

  it("delivering everything twice changes only the delivery counter", () => {
    const twice = experimentResults(pipeline([...scenario, ...scenario]), { clock });
    const once = experimentResults(pipeline(scenario), { clock });
    expect(twice.dataQuality.inbox.deliveries).toBe(1296);
    expect({ ...twice, dataQuality: { ...twice.dataQuality, inbox: { ...twice.dataQuality.inbox, deliveries: 0 }, duplicatesIgnored: 0 } }).toEqual({
      ...once,
      dataQuality: { ...once.dataQuality, inbox: { ...once.dataQuality.inbox, deliveries: 0 }, duplicatesIgnored: 0 },
    });
  });
});
